import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import {
  LAB_DAEMON_PATH,
  NETWORK_IDENTITY,
  PROFILE,
  RUNTIME_DIR,
} from "../lab/config.mjs";
import { verifyLaveRuntime } from "../lab/runtime.mjs";
import { parseRpcJson } from "../server/rpc.mjs";
import { CustomerSigner, createPaymentRequest } from "../signer/service.mjs";
import { SignerStore } from "../signer/store.mjs";
import { protectSigner } from "../backup/gate.mjs";
import { createWalletBackup, restoreWalletBackup } from "../backup/service.mjs";

assert.equal(
  PROFILE,
  "lave",
  "Native backup recovery integration requires the LAVE profile.",
);
await verifyLaveRuntime();
await mkdir(RUNTIME_DIR, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(RUNTIME_DIR, ".backup-integration-"));
await chmod(root, 0o700);
const nodes = [
  { id: "source", port: 20181 },
  { id: "recovered", port: 20182 },
];
const checks = [];
const passed = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
const stores = [];
const password = `throwaway-integration-${randomUUID()}`;
let interrupted = false;
function interrupt() {
  interrupted = true;
  for (const node of nodes)
    if (node.child && !node.exited) node.child.kill("SIGTERM");
}
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function raw(node, method, params = [], wallet) {
  const cookie = (
    await readFile(
      join(node.datadir, NETWORK_IDENTITY.chain, ".cookie"),
      "utf8",
    )
  ).trim();
  const response = await fetch(
    `http://127.0.0.1:${node.port}${wallet ? `/wallet/${encodeURIComponent(wallet)}` : "/"}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "backup-isolated-integration",
        method,
        params,
      }),
    },
  );
  const body = parseRpcJson(await response.text());
  if (body.error)
    throw Object.assign(new Error(body.error.message), {
      code: body.error.code,
    });
  assert.equal(response.status, 200);
  return body.result;
}
async function identity(node) {
  const chain = await raw(node, "getblockchaininfo");
  assert.equal(chain.chain, NETWORK_IDENTITY.chain);
  assert.equal(
    await raw(node, "getblockhash", [0]),
    NETWORK_IDENTITY.genesisHash,
  );
  assert.equal(
    await raw(node, "getblockhash", [1]),
    NETWORK_IDENTITY.devnetGenesisHash,
  );
  const network = await raw(node, "getnetworkinfo");
  assert.equal(network.networkactive, false);
  assert.equal(network.connections, 0);
  return chain;
}
async function waitFor(check, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (interrupted) throw new Error("Backup integration interrupted.");
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}
async function start(node) {
  node.datadir = join(root, node.id);
  await mkdir(node.datadir, { mode: 0o700 });
  const config = join(node.datadir, "lave.conf");
  await writeFile(
    config,
    [
      `devnet=${NETWORK_IDENTITY.devnetName}`,
      "server=1",
      "networkactive=0",
      "listen=0",
      "dnsseed=0",
      "fixedseeds=0",
      "dns=0",
      "discover=0",
      "listenonion=0",
      "upnp=0",
      "natpmp=0",
      "walletbroadcast=0",
      "dbcache=32",
      "par=1",
      "keypool=16",
      "fallbackfee=0.00001",
      "printtoconsole=0",
      "minimumdifficultyblocks=10000",
      "highsubsidyblocks=1",
      "highsubsidyfactor=1",
      "[devnet]",
      "connect=0",
      `rpcport=${node.port}`,
      "rpcbind=127.0.0.1",
      "rpcallowip=127.0.0.1",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  node.child = spawn(
    LAB_DAEMON_PATH,
    [`-datadir=${node.datadir}`, `-conf=${config}`],
    { stdio: "ignore" },
  );
  node.child.once("error", (error) => {
    node.failure = error;
  });
  node.child.once("close", () => {
    node.exited = true;
  });
  await waitFor(async () => {
    if (node.failure || node.exited)
      throw new Error(`Isolated ${node.id} node failed to start.`);
    try {
      await identity(node);
      return true;
    } catch (error) {
      if (
        error.code === "ENOENT" ||
        error.cause?.code === "ECONNREFUSED" ||
        error.code === -28
      )
        return false;
      throw error;
    }
  }, `Isolated ${node.id} RPC did not become ready.`);
}
async function relayBlocks(source, target) {
  const height = (await identity(source)).blocks;
  for (
    let index = (await identity(target)).blocks + 1;
    index <= height;
    index++
  ) {
    const hash = await raw(source, "getblockhash", [index]);
    const bytes = await raw(source, "getblock", [hash, 0]);
    assert.equal(await raw(target, "submitblock", [bytes]), null);
  }
  assert.equal(
    (await identity(target)).bestblockhash,
    (await identity(source)).bestblockhash,
  );
}
try {
  for (const node of nodes) {
    await start(node);
    assert.equal((await identity(node)).blocks, 1);
  }
  const [source, recovered] = nodes;
  for (const wallet of ["customer", "merchant"])
    await raw(source, "createwallet", [
      wallet,
      false,
      false,
      null,
      false,
      true,
      false,
    ]);
  const miningAddress = await raw(
    source,
    "getnewaddress",
    ["backup-test-mining"],
    "customer",
  );
  await raw(source, "generatetoaddress", [110, miningAddress]);
  await relayBlocks(source, recovered);
  passed(
    "Two fresh pinned LAVE nodes bootstrapped and synchronized by explicit block submission with zero P2P peers",
  );
  const journalPath = join(root, "customer.sqlite");
  const store = new SignerStore(journalPath);
  stores.push(store);
  let signs = 0,
    sends = 0;
  const sourceRpc = async (role, method, params = [], wallet) => {
    if (method === "walletprocesspsbt" && params[1] === true) signs++;
    const value = await raw(source, method, params, wallet);
    if (method === "sendrawtransaction") {
      sends++;
      throw new Error("Test-only loss after native broadcast");
    }
    return value;
  };
  const signer = protectSigner(
    new CustomerSigner({
      rpc: sourceRpc,
      assertNode: () => identity(source),
      identity: NETWORK_IDENTITY,
      store,
      role: "customer",
    }),
    journalPath,
  );
  const request = await createPaymentRequest({
    rpc: (_role, method, params, wallet) => raw(source, method, params, wallet),
    assertNode: () => identity(source),
    identity: NETWORK_IDENTITY,
    amount: "0.25",
    merchantName: "Recovery test",
    description: "Native descriptor backup recovery",
    expiresInMinutes: 60,
  });
  store.db.exec(
    "CREATE TABLE wallet_imports(invoice_id TEXT PRIMARY KEY,kind TEXT,request_id TEXT UNIQUE,receipt_key TEXT,receipt_state TEXT); CREATE TABLE wallet_settings(key TEXT PRIMARY KEY,value TEXT);",
  );
  store.db
    .prepare("INSERT INTO wallet_imports VALUES(?,?,?,?,?)")
    .run(request.id, "payment", request.id, randomUUID(), "pending");
  await signer.prepare(request);
  let entered, release;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const decision = new Promise((resolve) => {
    release = resolve;
  });
  const approving = signer.approve(request.id, async () => {
    entered();
    return decision;
  });
  const declined = assert.rejects(approving, { code: "APPROVAL_DENIED" });
  await ready;
  await assert.rejects(
    createWalletBackup({ signer, store, journalPath, password }),
    { code: "WALLET_BUSY" },
  );
  release(false);
  await declined;
  passed(
    "Backup is excluded while a real wallet approval operation holds the shared mutation gate",
  );
  await assert.rejects(
    signer.approve(request.id, async () => true),
    { code: "BROADCAST_UNCERTAIN" },
  );
  const saved = store.get(request.id);
  assert.equal(saved.state, "broadcast_unknown");
  assert.equal(signs, 1);
  assert.equal(sends, 1);
  const backup = await createWalletBackup({
    signer,
    store,
    journalPath,
    password,
  });
  assert.equal(backup.bytes.includes(Buffer.from(saved.rawHex)), false);
  const directory = join(root, "recovery-files");
  const recovery = await restoreWalletBackup({
    bytes: backup.bytes,
    password,
    directory,
    role: "customer",
    network: NETWORK_IDENTITY,
  });
  assert.deepEqual(await raw(recovered, "listwallets"), []);
  await raw(recovered, "restorewallet", [
    "customer",
    recovery.walletPath,
    false,
  ]);
  const walletInfo = await raw(recovered, "getwalletinfo", [], "customer");
  assert.equal(walletInfo.descriptors, true);
  assert.equal(walletInfo.private_keys_enabled, true);
  assert.equal(
    (await raw(recovered, "getaddressinfo", [miningAddress], "customer"))
      .ismine,
    true,
  );
  passed(
    "Authenticated bundle restored by native Core into an empty second node with original descriptor keys and signing journal",
  );
  const restoredStore = new SignerStore(recovery.journalPath);
  stores.push(restoredStore);
  assert.equal(restoredStore.get(request.id).rawHex, saved.rawHex);
  assert.equal(
    restoredStore.db.prepare("SELECT request_id FROM wallet_imports").get()
      .request_id,
    request.id,
  );
  let restoredSigns = 0,
    restoredFunding = 0,
    restoredSends = 0;
  const restoreRpc = async (_role, method, params, wallet) => {
    if (method === "walletprocesspsbt" && params[1] === true) restoredSigns++;
    if (method === "walletcreatefundedpsbt") restoredFunding++;
    if (method === "sendrawtransaction") {
      restoredSends++;
      assert.equal(params[0], saved.rawHex);
    }
    return raw(recovered, method, params, wallet);
  };
  const restoredSigner = protectSigner(
    new CustomerSigner({
      rpc: restoreRpc,
      assertNode: () => identity(recovered),
      identity: NETWORK_IDENTITY,
      store: restoredStore,
    }),
    recovery.journalPath,
  );
  const result = await restoredSigner.approve(request.id, async () => true);
  assert.equal(result.txid, saved.txid);
  assert.equal(result.state, "broadcast");
  await restoredSigner.approve(request.id, async () => {
    throw new Error("Duplicate retry must not request approval again");
  });
  assert.equal(restoredSigns, 0);
  assert.equal(restoredFunding, 0);
  assert.equal(restoredSends, 1);
  assert.deepEqual(await raw(recovered, "getrawmempool"), [saved.txid]);
  passed(
    "Recovery retries exactly the saved transaction bytes once: same txid, zero funding calls and zero new signatures",
  );
  await raw(recovered, "generatetoaddress", [1, miningAddress]);
  await relayBlocks(recovered, source);
  const received = await raw(
    source,
    "getreceivedbyaddress",
    [request.address, 1],
    "merchant",
  );
  assert.equal(received, "0.25000000");
  assert.equal(
    (await restoredSigner.status(request.id)).confirmationState,
    "confirmed",
  );
  passed(
    "Both isolated nodes confirm the same single 0.25 LAVE payment after recovery",
  );
  const newRequest = await createPaymentRequest({
    rpc: (_role, method, params, wallet) => raw(source, method, params, wallet),
    assertNode: () => identity(source),
    identity: NETWORK_IDENTITY,
    amount: "0.01",
    merchantName: "Recovery test",
    description: "Must remain locked",
  });
  await assert.rejects(restoredSigner.prepare(newRequest), {
    code: "RECOVERY_LOCKED",
  });
  assert.equal(restoredFunding, 0);
  assert.equal(restoredSigns, 0);
  passed(
    "Restored snapshot rejects every new payment so missing later journal activity cannot cause fresh spending",
  );
  await writeFile(
    join(RUNTIME_DIR, "backup-integration-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        network: NETWORK_IDENTITY,
        txid: saved.txid,
        checks,
        originalSignatures: signs,
        recoveredSignatures: restoredSigns,
        recoveredFundingCalls: restoredFunding,
        recoveredSameBytesBroadcasts: restoredSends,
        existingLabNodesUntouched: true,
        isolatedNodes: await Promise.all(
          nodes.map(async (node) => ({
            id: node.id,
            rpcPort: node.port,
            initialHeight: 1,
            finalHeight: (await identity(node)).blocks,
            p2pActive: false,
            peerCount: 0,
          })),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
} finally {
  for (const store of stores) store.close();
  for (const node of nodes) {
    if (!node.child || node.exited) continue;
    try {
      await raw(node, "stop");
    } catch {
      node.child.kill("SIGTERM");
    }
    const deadline = Date.now() + 15000;
    while (!node.exited && Date.now() < deadline) await delay(100);
    if (!node.exited) {
      node.child.kill("SIGKILL");
      await delay(500);
    }
  }
  if (nodes.every((node) => !node.child || node.exited))
    await rm(root, { recursive: true, force: true });
  else
    throw new Error(
      "Temporary backup node could not stop; its dedicated directory was retained.",
    );
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
console.log(
  `\n${checks.length} native backup/recovery checks passed; temporary nodes and plaintext wallet copies removed.`,
);
