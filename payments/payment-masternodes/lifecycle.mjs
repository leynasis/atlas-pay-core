import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, chmod, open, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { verifyLaveRuntime } from "../lab/runtime.mjs";
import { rpcAmount, parseAmount } from "../server/money.mjs";
import {
  NAME,
  CHAIN,
  WALLET,
  RUNTIME,
  PUBLIC_DIR,
  DAEMON,
  NODES,
  NODE_IDS,
  MN_IDS,
  EXISTING_IDS,
  QUORUMS,
} from "./config.mjs";
import { rpc, assertNode } from "./rpc.mjs";
import {
  loadState,
  saveState,
  readJson,
  writeJson,
  progress,
} from "./state.mjs";
import { dkgConnectionsReady } from "./availability.mjs";

const exec = promisify(execFile);
export async function waitFor(check, message, timeout = 90000, interval = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(interval);
  }
  throw new Error(message);
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
export async function online(id) {
  try {
    await rpc(id, "getblockchaininfo");
    return true;
  } catch (e) {
    if (e.code === "ENOENT" || e.cause?.code === "ECONNREFUSED") return false;
    throw e;
  }
}
async function seedConfig(id) {
  if (!MN_IDS.includes(id))
    throw new Error("Only dedicated seed daemons may be configured");
  const node = NODES[id],
    operator = await readJson(node.operator);
  if (!operator?.secret) throw new Error(`Missing seed operator key for ${id}`);
  await mkdir(node.datadir, { recursive: true, mode: 0o700 });
  await writeFile(
    node.conf,
    [
      `devnet=${NAME}`,
      "server=1",
      "dnsseed=0",
      "fixedseeds=0",
      "dns=0",
      "discover=0",
      "listenonion=0",
      "upnp=0",
      "natpmp=0",
      "dbcache=16",
      "par=1",
      "fallbackfee=0.00001",
      "minimumdifficultyblocks=10000",
      "highsubsidyblocks=1",
      "highsubsidyfactor=1",
      "disablewallet=1",
      `masternodeblsprivkey=${operator.secret}`,
      "debug=llmq",
      "debug=llmq-dkg",
      "[devnet]",
      "listen=1",
      `rpcport=${node.rpcPort}`,
      "rpcbind=127.0.0.1",
      "rpcallowip=127.0.0.1",
      `port=${node.p2pPort}`,
      `bind=127.0.0.1:${node.p2pPort}`,
      `externalip=127.0.0.1:${node.p2pPort}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await chmod(node.conf, 0o600);
}
export async function startNode(id) {
  if (!MN_IDS.includes(id))
    throw new Error(
      "Existing payment-node lifecycle belongs to the payment runtime",
    );
  if (await online(id)) {
    await assertNode(id);
    return;
  }
  await seedConfig(id);
  try {
    await exec(
      DAEMON,
      [
        `-datadir=${NODES[id].datadir}`,
        `-conf=${NODES[id].conf}`,
        "-daemonwait=1",
      ],
      { timeout: 90000, maxBuffer: 1024 * 1024 },
    );
  } catch {
    throw new Error(
      `Seed ${id} failed to start; inspect its private debug.log`,
    );
  }
  await waitFor(async () => {
    try {
      await assertNode(id);
      return true;
    } catch (e) {
      if (e.message.includes("Wrong") || e.message.includes("Non-lab")) throw e;
      return false;
    }
  }, `${id} did not start`);
}
export async function stopNode(id) {
  if (!MN_IDS.includes(id))
    throw new Error("Only dedicated seed daemons may be stopped");
  if (!(await online(id))) return;
  await assertNode(id);
  await rpc(id, "stop");
  await waitFor(
    async () =>
      !(await online(id)) &&
      !(await exists(join(NODES[id].datadir, CHAIN, "laved.pid"))),
    `${id} did not stop completely`,
    45000,
  );
}
export async function synchronize(ids = NODE_IDS) {
  const expected = await rpc("miner", "getbestblockhash");
  await waitFor(
    async () => {
      const hashes = await Promise.all(
        ids.map((id) => rpc(id, "getbestblockhash")),
      );
      return hashes.every((hash) => hash === expected);
    },
    "Payment seed nodes failed to synchronize",
    180000,
  );
}
async function assertActivation() {
  await Promise.all(EXISTING_IDS.map(assertNode));
  const values = await rpc("miner", "spork", ["show"]);
  for (const name of [
    "SPORK_2_INSTANTSEND_ENABLED",
    "SPORK_3_INSTANTSEND_BLOCK_FILTERING",
    "SPORK_17_QUORUM_DKG_ENABLED",
    "SPORK_19_CHAINLOCKS_ENABLED",
    "SPORK_21_QUORUM_ALL_CONNECTED",
    "SPORK_23_QUORUM_POSE",
  ])
    if (values[name] !== 0)
      throw new Error(
        "Upgrade and restart all payment nodes with the payment-quorum Core build before bootstrap",
      );
}
async function ensureWallet(state) {
  const wallets = await rpc("miner", "listwallets");
  if (!wallets.includes(WALLET)) {
    const disk = await rpc("miner", "listwalletdir");
    if (disk.wallets.some((w) => w.name === WALLET))
      await rpc("miner", "loadwallet", [WALLET]);
    else
      await rpc("miner", "createwallet", [
        WALLET,
        false,
        false,
        null,
        false,
        true,
        true,
      ]);
  }
  if (state.miningAddress) {
    if (
      (await rpc("miner", "getaddressinfo", [state.miningAddress], WALLET))
        .ismine !== true
    )
      throw new Error("Seed wallet does not own its saved mining address");
  } else {
    state.miningAddress = await rpc(
      "miner",
      "getnewaddress",
      ["seed-funding-mining"],
      WALLET,
    );
    await saveState(state);
  }
}
export async function mine(
  state,
  count = 1,
  { ids = NODE_IDS, pace = 1200 } = {},
) {
  if (!Number.isInteger(count) || count < 1 || count > 500)
    throw new Error("Mining count must be 1..500");
  await assertNode("miner");
  if (
    !state.miningAddress ||
    (await rpc("miner", "getaddressinfo", [state.miningAddress], WALLET))
      .ismine !== true
  )
    throw new Error(
      "Seed mining destination is not owned by the dedicated seed wallet",
    );
  if (pace === 0) {
    await rpc(
      "miner",
      "generatetoaddress",
      [count, state.miningAddress],
      undefined,
      180000,
    );
    await synchronize(ids);
  } else
    for (let i = 0; i < count; i++) {
      await rpc("miner", "generatetoaddress", [1, state.miningAddress]);
      await synchronize(ids);
      await delay(pace);
    }
}
async function coinLock(txid, vout, locked) {
  const current = await rpc("miner", "listlockunspent", [], WALLET);
  if (current.some((c) => c.txid === txid && c.vout === vout) !== locked)
    await rpc("miner", "lockunspent", [!locked, [{ txid, vout }]], WALLET);
}
export async function preparePayment(outputs) {
  await assertNode("miner");
  const funded = await rpc(
    "miner",
    "walletcreatefundedpsbt",
    [[], outputs, 0, { fee_rate: 1, changePosition: outputs.length }, true],
    WALLET,
  );
  const signed = await rpc("miner", "walletprocesspsbt", [funded.psbt], WALLET);
  const finalized = await rpc("miner", "finalizepsbt", [signed.psbt]);
  if (!finalized.complete)
    throw new Error(
      "Seed wallet did not completely sign its own test transaction",
    );
  return {
    raw: finalized.hex,
    txid: (await rpc("miner", "decoderawtransaction", [finalized.hex])).txid,
  };
}
export async function broadcastPrepared(tx) {
  if (!tx?.raw || !tx?.txid)
    throw new Error("Missing seed transaction journal");
  await assertNode("miner");
  try {
    const known = await rpc("miner", "gettransaction", [tx.txid], WALLET);
    if (known.confirmations > 0) return tx.txid;
  } catch (e) {
    if (e.code !== -5) throw e;
  }
  const txid = await rpc("miner", "sendrawtransaction", [tx.raw]);
  if (txid !== tx.txid) throw new Error("Seed broadcast identity mismatch");
  return txid;
}
async function confirmBatch(txids, state) {
  const unique = [...new Set(txids)];
  let tick = 0;
  await waitFor(
    async () => {
      const transactions = await Promise.all(
        unique.map((txid) => rpc("miner", "gettransaction", [txid], WALLET)),
      );
      if (transactions.every((tx) => tx.confirmations > 0)) return true;
      if (tick % 12 === 0)
        await progress(
          "confirming",
          `Waiting for ${transactions.filter((tx) => !(tx.confirmations > 0)).length} seed transactions under the existing real-time mining policy`,
        );
      await mine(state, 1, { ids: EXISTING_IDS, pace: 1200 });
      tick++;
      return false;
    },
    "Seed transactions did not confirm within the real-time safety window",
    720000,
    5000,
  );
}
async function prepareSeeds(state) {
  for (const id of MN_IDS) {
    if (state.masternodes[id]) continue;
    let operator = await readJson(NODES[id].operator);
    if (!operator) {
      operator = await rpc("miner", "bls", ["generate"]);
      await writeJson(NODES[id].operator, operator);
    }
    const labels = ["funds", "collateral", "owner", "voting", "payout"];
    const addresses = await Promise.all(
      labels.map((label) =>
        rpc("miner", "getnewaddress", [`${id}-${label}`], WALLET),
      ),
    );
    state.masternodes[id] = {
      id,
      publicKey: operator.public,
      ...Object.fromEntries(labels.map((key, i) => [key, addresses[i]])),
    };
    await saveState(state);
  }
  state.funding ||= {};
  await saveState(state);
  if (!MN_IDS.every((id) => state.masternodes[id].registration)) {
    await progress(
      "funding",
      "Mining fresh valueless LAVE directly to the dedicated seed wallet; existing customer and merchant funds are not used",
    );
    for (let n = 0; n < 60; n++) {
      const balance = await rpc("miner", "getbalances", [], WALLET);
      const externalTestFunding = Object.values(state.testFunding || {}).reduce(
        (sum, tx) => sum + parseAmount(tx.amount),
        0n,
      );
      if (
        rpcAmount(balance.mine.trusted) >=
        parseAmount("18200") - externalTestFunding
      )
        break;
      await mine(state, 100, { ids: EXISTING_IDS, pace: 0 });
      if (n % 5 === 0)
        await progress(
          "funding",
          `Dedicated seed-wallet mature balance: ${Number((await rpc("miner", "getbalances", [], WALLET)).mine.trusted).toFixed(2)} LAVE`,
        );
    }
  }
  for (const id of MN_IDS) {
    if (state.masternodes[id].registration) continue;
    if (state.funding[id]) {
      const coin = await rpc("miner", "gettxout", [state.funding[id].txid, 0]);
      if (coin) await coinLock(state.funding[id].txid, 0, true);
    }
  }
  for (const id of MN_IDS) {
    if (state.masternodes[id].registration) continue;
    const mn = state.masternodes[id];
    if (!state.funding[id]) {
      state.funding[id] = await preparePayment([{ [mn.funds]: "1000.1" }]);
      await saveState(state);
    }
    await broadcastPrepared(state.funding[id]);
    await coinLock(state.funding[id].txid, 0, true);
  }
  const pendingFunds = MN_IDS.filter(
    (id) => !state.masternodes[id].registration,
  ).map((id) => state.funding[id].txid);
  pendingFunds.push(
    ...Object.values(state.testFunding || {}).map((tx) => tx.txid),
  );
  if (pendingFunds.length) await confirmBatch(pendingFunds, state);
  for (const id of MN_IDS) {
    const mn = state.masternodes[id];
    if (!mn.registration) {
      await coinLock(state.funding[id].txid, 0, false);
      const raw = await rpc(
        "miner",
        "protx",
        [
          "register_fund",
          mn.collateral,
          [`127.0.0.1:${NODES[id].p2pPort}`],
          mn.owner,
          mn.publicKey,
          mn.voting,
          "0",
          mn.payout,
          mn.funds,
          false,
        ],
        WALLET,
        45000,
      );
      mn.registration = {
        raw,
        txid: (await rpc("miner", "decoderawtransaction", [raw])).txid,
      };
      mn.proTxHash = mn.registration.txid;
      await saveState(state);
    }
    await broadcastPrepared(mn.registration);
  }
  await confirmBatch(
    MN_IDS.map((id) => state.masternodes[id].proTxHash),
    state,
  );
  for (const id of MN_IDS) {
    const info = await rpc("miner", "protx", [
      "info",
      state.masternodes[id].proTxHash,
    ]);
    if (info.state.pubKeyOperator !== state.masternodes[id].publicKey)
      throw new Error(`Registered seed identity mismatch: ${id}`);
    state.masternodes[id].collateral = {
      txid: info.collateralHash,
      vout: info.collateralIndex,
    };
    await coinLock(info.collateralHash, info.collateralIndex, true);
  }
  await saveState(state);
  await progress(
    "registered",
    "Sixteen deterministic seed registrations confirmed with locked 1,000-LAVE test collateral",
  );
}
export async function connectNodes() {
  for (const id of MN_IDS) {
    await assertNode(id);
    const peers = await rpc(id, "getpeerinfo");
    if (!peers.some((p) => p.addr === `127.0.0.1:${NODES.miner.p2pPort}`))
      await rpc(id, "addnode", [`127.0.0.1:${NODES.miner.p2pPort}`, "onetry"]);
  }
  await synchronize();
  for (const id of NODE_IDS)
    for (let n = 0; n < 12; n++) {
      if ((await rpc(id, "mnsync", ["status"])).IsSynced) break;
      await rpc(id, "mnsync", ["next"]);
    }
}
export async function startMonitor() {
  await mkdir(PUBLIC_DIR, { recursive: true, mode: 0o700 });
  const lock = join(RUNTIME, "monitor.lock");
  if (await exists(join(RUNTIME, "stop-monitor")))
    await waitFor(
      async () => !(await exists(lock)),
      "Previous payment seed monitor did not stop",
      30000,
    );
  const heartbeat = await readJson(join(PUBLIC_DIR, "monitor.json"));
  if (await exists(lock)) {
    if (heartbeat && Date.now() - Date.parse(heartbeat.observedAt) < 15000)
      return;
    throw new Error(
      "Payment seed monitor lock is stale; inspect the owned process before removing it",
    );
  }
  await rm(join(RUNTIME, "stop-monitor"), { force: true });
  const log = await open(join(RUNTIME, "monitor.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./monitor.mjs", import.meta.url))],
    { detached: true, stdio: ["ignore", log.fd, log.fd] },
  );
  child.unref();
  await log.close();
  await waitFor(
    async () =>
      (await readJson(join(PUBLIC_DIR, "monitor.json")))?.pid === child.pid,
    "Payment seed monitor did not publish its first heartbeat",
    30000,
  );
}
export async function startLab() {
  await verifyLaveRuntime({ daemonPath: DAEMON });
  await assertActivation();
  const state = await loadState();
  await saveState(state);
  await ensureWallet(state);
  await startMonitor();
  await prepareSeeds(state);
  await progress(
    "synchronizing",
    "Starting sixteen payment-network seed masternodes with their persisted operator identities",
  );
  for (let offset = 0; offset < MN_IDS.length; offset += 4)
    await Promise.all(MN_IDS.slice(offset, offset + 4).map(startNode));
  await connectNodes();
  await mine(state, state.initializedAt ? 1 : 8);
  state.initializedAt ||= new Date().toISOString();
  await saveState(state);
  return state;
}
export async function waitForActiveConnections(state) {
  const lists = await rpc("miner", "quorum", ["list", 4]);
  const required = Object.fromEntries(MN_IDS.map((id) => [id, new Set()]));
  for (const params of Object.values(QUORUMS))
    for (const hash of (lists[params.name] || []).slice(0, params.active)) {
      const info = await rpc("miner", "quorum", [
        "info",
        params.type,
        hash,
        false,
      ]);
      const members = info.members
        .filter((m) => m.valid)
        .map((m) => m.proTxHash);
      for (const id of MN_IDS) {
        const own = state.masternodes[id].proTxHash;
        if (members.includes(own))
          for (const other of members)
            if (other !== own) required[id].add(other);
      }
    }
  await waitFor(
    async () => {
      const checks = await Promise.all(
        MN_IDS.map(async (id) => {
          const peers = await rpc(id, "getpeerinfo");
          const auth = new Set(peers.map((p) => p.verified_proregtx_hash));
          return [...required[id]].every((hash) => auth.has(hash));
        }),
      );
      return checks.every(Boolean);
    },
    "Active payment-quorum peers did not authenticate",
    120000,
    1000,
  );
}
export async function mineQuorums(state) {
  await progress(
    "dkg",
    "Forming existing-size payment quorums with real-time pacing: ChainLocks 12 members, rotated InstantSend 8 members",
  );
  for (let count = 0; count < 336; count++) {
    const list = await rpc("miner", "quorum", ["list", 4]);
    let fullQuorums = false;
    if (
      list[QUORUMS.chainLocks.name]?.length &&
      list[QUORUMS.instantSend.name]?.length >= 2
    ) {
      const groups = await Promise.all(
        Object.entries(QUORUMS).flatMap(([key, params]) =>
          list[params.name]
            .slice(0, key === "instantSend" ? 2 : 1)
            .map(async (hash) => {
              const info = await rpc("miner", "quorum", [
                "info",
                params.type,
                hash,
                false,
              ]);
              return (
                info.members.filter((member) => member.valid).length ===
                params.size
              );
            }),
        ),
      );
      fullQuorums = groups.every(Boolean);
    }
    if (fullQuorums) {
      await mine(state, 8);
      await waitForActiveConnections(state);
      await progress(
        "ready",
        "Payment-network ChainLocks and rotated InstantSend quorums are mined and mature",
      );
      return;
    }
    await mine(state, 1);
    const height = await rpc("miner", "getblockcount");
    if (height % 24 === 0 || height % 48 === 1)
      await waitFor(
        async () => {
          const all = await Promise.all(
            MN_IDS.map((id) => rpc(id, "quorum", ["dkgstatus"])),
          );
          return all.every((status) =>
            dkgConnectionsReady(status, [
              QUORUMS.chainLocks.name,
              QUORUMS.instantSend.name,
            ]),
          );
        },
        "Payment DKG connections did not authenticate",
        120000,
        1000,
      );
    await waitFor(
      async () => {
        const all = await Promise.all(
          MN_IDS.map((id) => rpc(id, "quorum", ["dkgstatus"])),
        );
        return all.every((status) =>
          (status.session || [])
            .filter((s) =>
              [QUORUMS.chainLocks.name, QUORUMS.instantSend.name].includes(
                s.llmqType,
              ),
            )
            .every((s) => {
              const target = s.llmqType === QUORUMS.chainLocks.name ? 12 : 8;
              const connections = (status.quorumConnections || []).find(
                (q) =>
                  q.llmqType === s.llmqType && q.quorumIndex === s.quorumIndex,
              )?.quorumConnections;
              const expected = Math.min(target, (connections?.length || 0) + 1);
              if (s.status.phase === 2)
                return s.status.receivedContributions >= expected;
              if (s.status.phase === 5 && expected === target)
                return s.status.receivedPrematureCommitments >= expected;
              return true;
            }),
        );
      },
      "Payment DKG contributions or commitments did not arrive",
      90000,
      500,
    );
    if (height % 48 === 0)
      await progress(
        "dkg",
        `Payment InstantSend rotation cycle at height ${height}`,
      );
  }
  throw new Error(
    "Payment DKG did not produce both quorum types within the bounded bootstrap",
  );
}
export async function stopLab() {
  await progress(
    "stopping",
    "Stopping only the sixteen payment seed daemons; ordinary payment nodes keep running",
  );
  await Promise.all(MN_IDS.map(stopNode));
  await writeFile(join(RUNTIME, "stop-monitor"), "stop\n", { mode: 0o600 });
  await progress(
    "stopped",
    "Payment seed daemons stopped; collateral and registrations remain locked on chain",
  );
}
