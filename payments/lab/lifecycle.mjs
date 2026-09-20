import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { install } from "../network/install.mjs";
import { parseAmount } from "../server/money.mjs";
import {
  CURRENCY,
  PROFILE,
  PROFILE_CONFIG,
  LAB_DAEMON_PATH,
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  HIGH_SUBSIDY_BLOCKS,
  HIGH_SUBSIDY_FACTOR,
  LAB_DIR,
  LAB_NAME,
  MINIMUM_DIFFICULTY_BLOCKS,
  MINER_API_METHODS,
  MINER_API_CREDENTIALS_PATH,
  MERCHANT_API_METHODS,
  MERCHANT_API_CREDENTIALS_PATH,
  NODE_IDS,
  NODES,
  READ_ONLY_METHODS,
  getNode,
} from "./config.mjs";
import { assertLabNode, inspectNode, rpc } from "./rpc.mjs";
import { verifyLaveRuntime } from "./runtime.mjs";
import { ensureCashier } from "./cashier.mjs";

const exec = promisify(execFile);
const fundingJournalPath = join(LAB_DIR, "funding.json");
async function saveFundingJournal(journal) {
  const temp = `${fundingJournalPath}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(journal, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, fundingJournalPath);
}
export async function waitUntil(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(message);
}

async function prepareNode(nodeId) {
  const node = getNode(nodeId);
  await mkdir(node.datadir, { recursive: true, mode: 0o700 });
  await mkdir(join(LAB_DIR, "dashboard"), { recursive: true, mode: 0o700 });
  let credential;
  try {
    credential = JSON.parse(
      await readFile(node.dashboardCredentialsPath, "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    credential = {
      username: `${PROFILE}_dashboard_${nodeId}`,
      password: randomBytes(32).toString("hex"),
      salt: randomBytes(16).toString("hex"),
    };
    await writeFile(node.dashboardCredentialsPath, JSON.stringify(credential), {
      mode: 0o600,
    });
  }
  const digest = createHmac("sha256", credential.salt)
    .update(credential.password)
    .digest("hex");
  const merchantAuth = [];
  if (nodeId === "merchant") {
    await mkdir(join(LAB_DIR, "merchant-api"), {
      recursive: true,
      mode: 0o700,
    });
    let apiCredential;
    try {
      apiCredential = JSON.parse(
        await readFile(MERCHANT_API_CREDENTIALS_PATH, "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      apiCredential = {
        username: `${PROFILE}_merchant_api`,
        password: randomBytes(32).toString("hex"),
        salt: randomBytes(16).toString("hex"),
      };
      await writeFile(
        MERCHANT_API_CREDENTIALS_PATH,
        JSON.stringify(apiCredential),
        { mode: 0o600 },
      );
    }
    const apiDigest = createHmac("sha256", apiCredential.salt)
      .update(apiCredential.password)
      .digest("hex");
    merchantAuth.push(
      `rpcauth=${apiCredential.username}:${apiCredential.salt}$${apiDigest}`,
      `rpcwhitelist=${apiCredential.username}:${MERCHANT_API_METHODS.join(",")}`,
    );
  }
  if (nodeId === "miner") {
    await mkdir(join(LAB_DIR, "miner-api"), { recursive: true, mode: 0o700 });
    let apiCredential;
    try {
      apiCredential = JSON.parse(
        await readFile(MINER_API_CREDENTIALS_PATH, "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      apiCredential = {
        username: `${PROFILE}_miner_api`,
        password: randomBytes(32).toString("hex"),
        salt: randomBytes(16).toString("hex"),
      };
      await writeFile(
        MINER_API_CREDENTIALS_PATH,
        JSON.stringify(apiCredential),
        { mode: 0o600 },
      );
    }
    const digest = createHmac("sha256", apiCredential.salt)
      .update(apiCredential.password)
      .digest("hex");
    merchantAuth.push(
      `rpcauth=${apiCredential.username}:${apiCredential.salt}$${digest}`,
      `rpcwhitelist=${apiCredential.username}:${MINER_API_METHODS.join(",")}`,
    );
  }
  const config = [
    `devnet=${LAB_NAME}`,
    "server=1",
    "networkactive=1",
    "dnsseed=0",
    "fixedseeds=0",
    "dns=0",
    "discover=0",
    "listenonion=0",
    "upnp=0",
    "natpmp=0",
    "dbcache=64",
    "par=1",
    "fallbackfee=0.00001",
    `minimumdifficultyblocks=${MINIMUM_DIFFICULTY_BLOCKS}`,
    `highsubsidyblocks=${HIGH_SUBSIDY_BLOCKS}`,
    `highsubsidyfactor=${HIGH_SUBSIDY_FACTOR}`,
    `rpcauth=${credential.username}:${credential.salt}$${digest}`,
    "rpcwhitelistdefault=0",
    `rpcwhitelist=${credential.username}:${READ_ONLY_METHODS.join(",")}`,
    ...merchantAuth,
    "[devnet]",
    "connect=0",
    "listen=1",
    `rpcport=${node.rpcPort}`,
    "rpcbind=127.0.0.1",
    "rpcallowip=127.0.0.1",
    `port=${node.p2pPort}`,
    `bind=127.0.0.1:${node.p2pPort}`,
    "",
  ].join("\n");
  await writeFile(node.configPath, config, { mode: 0o600 });
  await chmod(node.configPath, 0o600);
}

export async function startNode(nodeId) {
  const node = getNode(nodeId);
  try {
    await rpc(nodeId, "getblockchaininfo");
    await assertLabNode(nodeId);
    await ensureWallet(nodeId);
    return;
  } catch (error) {
    if (
      error.message.includes("identity mismatch") ||
      error.message.includes("isolation") ||
      error.code === "LAB_PEER_HANDSHAKE_PENDING" ||
      error.status === 401 ||
      error.status === 403
    )
      throw error;
    if (error.code !== "ENOENT" && error.cause?.code !== "ECONNREFUSED") {
      // A live but non-matching/inactive daemon is never replaced silently.
      if (error.message.includes("P2P") || error.code === -8) throw error;
    }
  }
  if (PROFILE === "lave") await verifyLaveRuntime();
  await prepareNode(nodeId);
  try {
    await exec(
      LAB_DAEMON_PATH,
      [`-datadir=${node.datadir}`, `-conf=${node.configPath}`, "-daemonwait=1"],
      { timeout: 60000 },
    );
  } catch {
    throw new Error(
      `Could not start ${nodeId}. Inspect its dedicated lab debug.log.`,
    );
  }
  await waitUntil(async () => {
    try {
      await assertLabNode(nodeId);
      return true;
    } catch (error) {
      if (
        error.message.includes("identity mismatch") ||
        error.message.includes("isolation")
      )
        throw error;
      return false;
    }
  }, `Lab node ${nodeId} failed identity/readiness checks.`);
  await ensureWallet(nodeId);
}

export async function stopNode(nodeId) {
  try {
    await assertLabNode(nodeId, { allowInactive: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.cause?.code === "ECONNREFUSED") return;
    throw error;
  }
  const pid = Number((await readFile(getNode(nodeId).pidPath, "utf8")).trim());
  await rpc(nodeId, "stop");
  await waitUntil(async () => {
    try {
      await readFile(getNode(nodeId).cookiePath);
      return false;
    } catch (error) {
      if (error.code === "ENOENT") {
        // Cookie removal precedes final wallet flush and datadir lock release.
        try {
          process.kill(pid, 0);
          return false;
        } catch (processError) {
          if (processError.code === "ESRCH") return true;
          throw processError;
        }
      }
      throw error;
    }
  }, `Lab node ${nodeId} did not stop.`);
}

export async function connectLab({ transport = rpc, timeout = 30000 } = {}) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new Error("Lab connection timeout must be between 1 and 30000 ms.");
  const deadline = Date.now() + timeout;
  const timeoutMessage = "Local lab peer links did not become ready.";
  const remaining = () => Math.max(0, deadline - Date.now());
  const inspectReadyNode = async (id) => {
    try {
      return await inspectNode(id, transport);
    } catch (error) {
      if (error.code === "LAB_PEER_HANDSHAKE_PENDING") return null;
      throw error;
    }
  };
  // A directed triangle gives each node two local peers without address discovery.
  for (let i = 0; i < NODE_IDS.length; i++) {
    const id = NODE_IDS[i];
    const target = NODES[NODE_IDS[(i + 1) % NODE_IDS.length]];
    let info;
    await waitUntil(
      async () => Boolean((info = await inspectReadyNode(id))),
      timeoutMessage,
      remaining(),
    );
    if (
      !info.peers.some(
        (peer) => !peer.inbound && peer.addr === `127.0.0.1:${target.p2pPort}`,
      )
    ) {
      await transport(id, "addnode", [`127.0.0.1:${target.p2pPort}`, "onetry"]);
    }
  }
  await waitUntil(
    async () =>
      (await Promise.all(NODE_IDS.map(inspectReadyNode))).every(
        (info) => info !== null && info.peers.length >= 2,
      ),
    timeoutMessage,
    remaining(),
  );
}

export async function waitForSync() {
  await waitUntil(async () => {
    const chains = await Promise.all(NODE_IDS.map((id) => assertLabNode(id)));
    return chains.every(
      (chain) => chain.bestblockhash === chains[0].bestblockhash,
    );
  }, "Lab nodes did not converge to the same chain tip.");
}

async function ensureWallet(nodeId) {
  await assertLabNode(nodeId);
  const node = getNode(nodeId);
  if ((await rpc(nodeId, "listwallets")).includes(node.wallet)) return;
  const found = (await rpc(nodeId, "listwalletdir")).wallets.some(
    (wallet) => wallet.name === node.wallet,
  );
  await assertLabNode(nodeId);
  if (!found && PROFILE === "lave" && ["merchant", "signer"].includes(nodeId))
    return;
  await rpc(
    nodeId,
    found ? "loadwallet" : "createwallet",
    found || !PROFILE_CONFIG.descriptors
      ? [node.wallet]
      : [node.wallet, false, false, null, false, true, true],
  );
}

export async function mineBlocks(blocks = 1) {
  if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 110)
    throw new Error("Generate between 1 and 110 lab blocks per operation.");
  await assertLabNode("miner");
  const address = await rpc(
    "miner",
    "getnewaddress",
    [`${PROFILE}-lab-mining`],
    "miner",
  );
  await assertLabNode("miner");
  const hashes = await rpc(
    "miner",
    "generatetoaddress",
    [blocks, address],
    undefined,
    { timeout: 60000 },
  );
  if (hashes.length !== blocks)
    throw new Error("Requested block count was not generated.");
  await waitForSync();
  return hashes;
}

export async function ensureLabRuntime() {
  if (PROFILE === "atlas") {
    await install();
    return;
  }
  await verifyLaveRuntime();
}

export async function startLab() {
  await ensureLabRuntime();
  for (const id of NODE_IDS) await startNode(id);
  await connectLab();
  await waitForSync();
  for (const id of NODE_IDS) await ensureWallet(id);
  await ensureCashier();
  let journal = { operations: [] };
  try {
    journal = JSON.parse(await readFile(fundingJournalPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (journal.operations.some((operation) => operation.state === "pending")) {
    throw new Error(
      "An earlier lab funding send has an uncertain result. Inspect the miner wallet and funding.json before retrying; no new funds were sent.",
    );
  }
  const planned = [];
  let needsConfirmation = false;
  for (const [id, amount] of [
    ["customer", "20"],
    ["merchant", "2"],
  ]) {
    const view = await rpc(id, "getbalances", [], NODES[id].wallet);
    const balances =
      id === "merchant" && PROFILE === "lave"
        ? view.watchonly || view.mine
        : view.mine;
    const trusted = parseAmount(String(balances.trusted), { allowZero: true });
    const pending = parseAmount(String(balances.untrusted_pending), {
      allowZero: true,
    });
    const minimum = parseAmount(id === "customer" ? "5" : "1");
    if (trusted + pending >= minimum) {
      if (trusted < minimum) needsConfirmation = true;
      continue;
    }
    planned.push({ id, amount });
  }
  if (planned.length) {
    const required = planned.reduce(
      (sum, item) => sum + parseAmount(item.amount),
      parseAmount("0.01"),
    );
    const minerBalance = async () =>
      parseAmount(
        String(
          await rpc("miner", "getbalance", ["*", 1, false, false], "miner"),
        ),
        { allowZero: true },
      );
    if ((await minerBalance()) < required) await mineBlocks(110);
    if ((await minerBalance()) < required)
      throw new Error(
        "Miner still lacks mature bootstrap funds after bounded mining.",
      );
  }
  for (const { id, amount } of planned) {
    await assertLabNode(id);
    const address = await rpc(
      id,
      "getnewaddress",
      [`${PROFILE}-lab-startup-funds`],
      NODES[id].wallet,
    );
    await assertLabNode("miner");
    const operation = {
      id: randomUUID(),
      node: id,
      address,
      amount,
      state: "pending",
      txid: null,
    };
    journal.operations.push(operation);
    await saveFundingJournal(journal);
    operation.txid = await rpc(
      "miner",
      "sendtoaddress",
      [address, amount, `${PROFILE}-lab-bootstrap:${operation.id}`],
      "miner",
    );
    operation.state = "complete";
    await saveFundingJournal(journal);
    needsConfirmation = true;
  }
  if (needsConfirmation) await mineBlocks(1);
  await writeFile(
    join(LAB_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        name: LAB_NAME,
        profile: PROFILE,
        currency: CURRENCY,
        walletType: PROFILE_CONFIG.descriptors ? "descriptor" : "legacy",
        chain: EXPECTED_CHAIN,
        genesisHash: GENESIS_HASH,
        devnetGenesisHash: DEVNET_GENESIS_HASH,
        parameters: {
          minimumdifficultyblocks: MINIMUM_DIFFICULTY_BLOCKS,
          highsubsidyblocks: HIGH_SUBSIDY_BLOCKS,
          highsubsidyfactor: HIGH_SUBSIDY_FACTOR,
        },
        nodes: NODE_IDS.map((id) => ({
          id,
          rpcPort: NODES[id].rpcPort,
          p2pPort: NODES[id].p2pPort,
        })),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}
