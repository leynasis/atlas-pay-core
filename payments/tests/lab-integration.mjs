import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  LAB_DIR,
  NODE_IDS,
  NODES,
} from "../lab/config.mjs";
import { assertLabNode, rpc, verifyIdentity } from "../lab/rpc.mjs";
import {
  connectLab,
  mineBlocks,
  startLab,
  startNode,
  stopNode,
  waitForSync,
  waitUntil,
} from "../lab/lifecycle.mjs";
import { getLabStatus } from "../lab/status.mjs";
import { rpc as legacyRpc } from "../network/rpc.mjs";
import { parseAmount } from "../server/money.mjs";

const results = [];
const check = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
const initialRegtest = await legacyRpc("getblockchaininfo");
const before = await getLabStatus();
await startLab();
let status = await getLabStatus();
assert.equal(status.onlineNodes, 3);
assert.equal(status.synchronized, true);
if (before.onlineNodes === 3)
  assert.equal(status.commonHeight, before.commonHeight);
await startLab();
assert.equal((await getLabStatus()).commonHeight, status.commonHeight);
check(
  "Three nodes agree; funded repeat startup generates no additional blocks",
);

for (const id of NODE_IDS) {
  const info = await assertLabNode(id);
  assert.equal(info.chain, EXPECTED_CHAIN);
  assert.equal(info.genesisHash, GENESIS_HASH);
  assert.equal(info.devnetGenesisHash, DEVNET_GENESIS_HASH);
  assert.equal(info.peers.length, 2);
  assert.deepEqual(await rpc(id, "listwallets"), [id]);
}
const genesisBlock = await rpc("miner", "getblock", [DEVNET_GENESIS_HASH, 2]);
assert.equal(
  genesisBlock.tx[0].vout.reduce(
    (sum, output) => sum + parseAmount(output.value, { allowZero: true }),
    0n,
  ),
  parseAmount("50"),
);
const secondHash = await rpc("miner", "getblockhash", [2]);
const secondBlock = await rpc("miner", "getblock", [secondHash, 2]);
assert.equal(
  secondBlock.tx[0].vout.reduce(
    (sum, output) => sum + parseAmount(output.value, { allowZero: true }),
    0n,
  ),
  parseAmount("5"),
);
assert.throws(
  () =>
    verifyIdentity(EXPECTED_CHAIN, GENESIS_HASH, initialRegtest.bestblockhash),
  /identity mismatch/,
);
check(
  "Named genesis pinned; 50 DASH block1 and normal 5 DASH block2; wrong genesis rejected",
);

for (const id of NODE_IDS) {
  const credential = JSON.parse(
    await readFile(NODES[id].dashboardCredentialsPath, "utf8"),
  );
  for (const method of ["sendtoaddress", "stop", "getwalletinfo"]) {
    const response = await fetch(NODES[id].rpcUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "restricted-test",
        method,
        params: [],
      }),
    });
    assert.equal(response.status, 403, `${id} dashboard must reject ${method}`);
    await response.text();
  }
}
check(
  "Dash itself denies send, stop and wallet reads to every dashboard credential",
);

await assertLabNode("customer");
const customerAddress = await rpc(
  "customer",
  "getnewaddress",
  ["key-boundary-check"],
  "customer",
);
assert.equal(
  (await rpc("customer", "getaddressinfo", [customerAddress], "customer"))
    .ismine,
  true,
);
assert.equal(
  (await rpc("merchant", "getaddressinfo", [customerAddress], "merchant"))
    .ismine,
  false,
);
assert.equal(
  (await rpc("miner", "getaddressinfo", [customerAddress], "miner")).ismine,
  false,
);
check("Customer key is present only in customer wallet");

const baseline = status.commonHeight;
await mineBlocks(1);
status = await getLabStatus();
assert.equal(status.commonHeight, baseline + 1);
check("A real block propagates to merchant and customer nodes");

async function localMine(nodeId, count, allowInactive = false) {
  await assertLabNode(nodeId, { allowInactive });
  const address = await rpc(
    nodeId,
    "getnewaddress",
    ["lab-recovery-test"],
    nodeId,
  );
  await assertLabNode(nodeId, { allowInactive });
  return rpc(nodeId, "generatetoaddress", [count, address]);
}

try {
  await stopNode("merchant");
  assert.equal((await getLabStatus()).onlineNodes, 2);
  const hashes = await localMine("miner", 2);
  await waitUntil(
    async () => (await rpc("customer", "getbestblockhash")) === hashes.at(-1),
    "Customer did not receive blocks while merchant was stopped.",
  );
  await startNode("merchant");
  await connectLab();
  await waitForSync();
  assert.equal((await getLabStatus()).commonTip, hashes.at(-1));
  check("Stopped merchant restarts and catches up with blocks it missed");

  await assertLabNode("merchant");
  await rpc("merchant", "setnetworkactive", [false]);
  await waitUntil(
    async () => (await rpc("merchant", "getpeerinfo")).length === 0,
    "Merchant failed to disconnect.",
  );
  const minority = await localMine("merchant", 1, true);
  const majority = await localMine("miner", 2);
  assert.notEqual(minority.at(-1), majority.at(-1));
  assert.equal((await getLabStatus()).synchronized, false);
  await assertLabNode("merchant", { allowInactive: true });
  await rpc("merchant", "setnetworkactive", [true]);
  await connectLab();
  await waitForSync();
  const recovered = await getLabStatus();
  assert.equal(recovered.commonTip, majority.at(-1));
  assert.equal(recovered.synchronized, true);
  check(
    "Partitioned node drops its shorter branch and rejoins the common chain",
  );
} finally {
  try {
    await assertLabNode("merchant", { allowInactive: true });
    await rpc("merchant", "setnetworkactive", [true]);
  } catch (error) {
    if (error.code === "ENOENT" || error.cause?.code === "ECONNREFUSED")
      await startNode("merchant");
    else throw error;
  }
  await connectLab();
  await waitForSync();
}

const finalRegtest = await legacyRpc("getblockchaininfo");
assert.equal(finalRegtest.bestblockhash, initialRegtest.bestblockhash);
assert.equal(finalRegtest.blocks, initialRegtest.blocks);
check("Original single-node regtest chain is untouched");
const finalStatus = await getLabStatus();
await writeFile(
  join(LAB_DIR, "integration-report.json"),
  JSON.stringify(
    { testedAt: new Date().toISOString(), results, status: finalStatus },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `${results.length} lab integration checks passed. All three nodes remain running.`,
);
