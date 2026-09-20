import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, chmod, open, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { verifyLaveRuntime } from "../lab/runtime.mjs";
import {
  NAME,
  CHAIN,
  RUNTIME,
  PUBLIC_DIR,
  DAEMON,
  NODES,
  NODE_IDS,
  MN_IDS,
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

const exec = promisify(execFile);
export async function waitFor(check, message, timeout = 60000, interval = 250) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await delay(interval);
  }
  throw new Error(message);
}
export async function online(id) {
  try {
    await rpc(id, "getblockchaininfo");
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.cause?.code === "ECONNREFUSED")
      return false;
    throw error;
  }
}
async function prepareNode(id, state) {
  const node = NODES[id];
  await mkdir(node.datadir, { recursive: true, mode: 0o700 });
  const operator = id === "controller" ? null : await readJson(node.operator);
  if (id !== "controller" && !operator?.secret)
    throw new Error(`Missing operator key for ${id}`);
  const config = [
    `devnet=${NAME}`,
    "server=1",
    "dnsseed=0",
    "fixedseeds=0",
    "dns=0",
    "discover=0",
    "listenonion=0",
    "upnp=0",
    "natpmp=0",
    "dbcache=32",
    "par=1",
    "fallbackfee=0.00001",
    "minimumdifficultyblocks=10000",
    "highsubsidyblocks=1",
    "highsubsidyfactor=1",
    "debug=llmq",
    "debug=llmq-dkg",
    `mocktime=${state.mockTime}`,
    ...(operator
      ? ["disablewallet=1", `masternodeblsprivkey=${operator.secret}`]
      : ["txindex=1"]),
    "[devnet]",
    ...(id === "controller" ? ["connect=0"] : []),
    "listen=1",
    `rpcport=${node.rpcPort}`,
    "rpcbind=127.0.0.1",
    "rpcallowip=127.0.0.1",
    `port=${node.p2pPort}`,
    `bind=127.0.0.1:${node.p2pPort}`,
    `externalip=127.0.0.1:${node.p2pPort}`,
    "",
  ].join("\n");
  await writeFile(node.conf, config, { mode: 0o600 });
  await chmod(node.conf, 0o600);
}
export async function startNode(id, state) {
  if (await online(id)) {
    await assertNode(id);
    return;
  }
  await prepareNode(id, state);
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
      `Unable to start ${id}; inspect its isolated lab debug.log`,
    );
  }
  await waitFor(
    async () => {
      try {
        await assertNode(id);
        return true;
      } catch (error) {
        if (
          error.message.includes("Wrong") ||
          error.message.includes("Non-lab")
        )
          throw error;
        return false;
      }
    },
    `${id} failed to start`,
    90000,
  );
}
export async function stopNode(id) {
  if (!(await online(id))) return;
  await assertNode(id);
  await rpc(id, "stop");
  await waitFor(
    async () => {
      if (await online(id)) return false;
      try {
        await access(join(NODES[id].datadir, CHAIN, "laved.pid"));
        return false;
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
    },
    `${id} did not stop completely`,
    45000,
  );
}
export async function ensureWallet() {
  const loaded = await rpc("controller", "listwallets");
  if (loaded.includes("controller")) return;
  const stored = await rpc("controller", "listwalletdir");
  if (stored.wallets.some((wallet) => wallet.name === "controller"))
    await rpc("controller", "loadwallet", ["controller"]);
  else
    await rpc("controller", "createwallet", [
      "controller",
      false,
      false,
      null,
      false,
      true,
      true,
    ]);
}
export async function setClock(state, delta = 1, ids = NODE_IDS) {
  state.mockTime = Math.max(
    state.mockTime + delta,
    Math.floor(Date.now() / 1000),
  );
  await Promise.all(
    ids.map(async (id) => {
      if (await online(id)) {
        await assertNode(id);
        await rpc(id, "setmocktime", [state.mockTime]);
      }
    }),
  );
  await saveState(state);
}
export async function synchronize(ids = NODE_IDS, timeout = 90000) {
  const hash = await rpc("controller", "getbestblockhash");
  await waitFor(
    async () => {
      const hashes = await Promise.all(
        ids.map((id) => rpc(id, "getbestblockhash")),
      );
      return hashes.every((value) => value === hash);
    },
    "Masternode lab chain synchronization timed out",
    timeout,
  );
}
export async function mine(
  state,
  count = 1,
  { ids = NODE_IDS, pace = 0 } = {},
) {
  if (!Number.isInteger(count) || count < 1 || count > 2500)
    throw new Error("Mining count must be 1..2500");
  await assertNode("controller");
  if (!state.miningAddress) {
    state.miningAddress = await rpc(
      "controller",
      "getnewaddress",
      ["isolated-lab-mining"],
      "controller",
    );
    await saveState(state);
  }
  if (!pace) {
    await setClock(state, count, ids);
    await rpc(
      "controller",
      "generatetoaddress",
      [count, state.miningAddress],
      undefined,
      180000,
    );
    await synchronize(ids);
  } else
    for (let index = 0; index < count; index++) {
      await setClock(state, 1, ids);
      await rpc("controller", "generatetoaddress", [1, state.miningAddress]);
      await synchronize(ids);
      await delay(pace);
    }
}
export async function connectNodes(ids = MN_IDS) {
  for (const id of ids) {
    await assertNode(id);
    const peers = await rpc(id, "getpeerinfo");
    if (
      !peers.some(
        (peer) => peer.addr === `127.0.0.1:${NODES.controller.p2pPort}`,
      )
    )
      await rpc(id, "addnode", [
        `127.0.0.1:${NODES.controller.p2pPort}`,
        "onetry",
      ]);
  }
  await synchronize(["controller", ...ids]);
  for (const id of ["controller", ...ids])
    for (let attempt = 0; attempt < 12; attempt++) {
      if ((await rpc(id, "mnsync", ["status"])).IsSynced) break;
      await rpc(id, "mnsync", ["next"]);
    }
}
export async function broadcastPrepared(transaction) {
  if (!transaction?.raw || !transaction?.txid)
    throw new Error("Missing signed transaction journal");
  await assertNode("controller");
  try {
    const known = await rpc("controller", "getrawtransaction", [
      transaction.txid,
      true,
    ]);
    if (known.txid === transaction.txid && known.confirmations > 0)
      return transaction.txid;
  } catch (error) {
    if (error.code !== -5) throw error;
  }
  const txid = await rpc("controller", "sendrawtransaction", [transaction.raw]);
  if (txid !== transaction.txid)
    throw new Error("Broadcast transaction identity mismatch");
  return txid;
}
export async function waitForActiveConnections(state) {
  const lists = await rpc("controller", "quorum", ["list", 2]);
  const required = Object.fromEntries(MN_IDS.map((id) => [id, new Set()]));
  for (const params of Object.values(QUORUMS)) {
    for (const hash of lists[params.name] || []) {
      const info = await rpc("controller", "quorum", [
        "info",
        params.type,
        hash,
        false,
      ]);
      const members = info.members
        .filter((member) => member.valid)
        .map((member) => member.proTxHash);
      for (const id of MN_IDS) {
        const own = state.masternodes[id].proTxHash;
        if (members.includes(own))
          for (const member of members)
            if (member !== own) required[id].add(member);
      }
    }
  }
  await waitFor(
    async () => {
      await setClock(state, 1);
      const checks = await Promise.all(
        MN_IDS.map(async (id) => {
          const peers = await rpc(id, "getpeerinfo");
          const authenticated = new Set(
            peers.map((peer) => peer.verified_proregtx_hash),
          );
          return [...required[id]].every((hash) => authenticated.has(hash));
        }),
      );
      return checks.every(Boolean);
    },
    "Active quorum members did not reconnect and authenticate",
    60000,
    500,
  );
}
async function setCoinLock(txid, vout, locked) {
  const current = await rpc("controller", "listlockunspent", [], "controller");
  if (
    current.some((coin) => coin.txid === txid && coin.vout === vout) !== locked
  )
    await rpc(
      "controller",
      "lockunspent",
      [!locked, [{ txid, vout }]],
      "controller",
    );
}
export async function preparePayment(outputs) {
  await assertNode("controller");
  const funded = await rpc(
    "controller",
    "walletcreatefundedpsbt",
    [[], outputs, 0, { fee_rate: 1, changePosition: outputs.length }, true],
    "controller",
  );
  const signed = await rpc(
    "controller",
    "walletprocesspsbt",
    [funded.psbt],
    "controller",
  );
  const finalized = await rpc("controller", "finalizepsbt", [signed.psbt]);
  if (!finalized.complete)
    throw new Error("Controller failed to sign its own local test transaction");
  const decoded = await rpc("controller", "decoderawtransaction", [
    finalized.hex,
  ]);
  return { raw: finalized.hex, txid: decoded.txid };
}
async function prepareRegistrations(state) {
  for (const id of MN_IDS) {
    if (state.masternodes[id]) continue;
    let operator = await readJson(NODES[id].operator);
    if (!operator) {
      operator = await rpc("controller", "bls", ["generate"]);
      await writeJson(NODES[id].operator, operator);
    }
    const addresses = await Promise.all(
      ["funds", "collateral", "owner", "voting", "payout"].map((label) =>
        rpc("controller", "getnewaddress", [`${id}-${label}`], "controller"),
      ),
    );
    state.masternodes[id] = {
      id,
      publicKey: operator.public,
      ...Object.fromEntries(
        ["funds", "collateral", "owner", "voting", "payout"].map(
          (key, index) => [key, addresses[index]],
        ),
      ),
    };
    await saveState(state);
  }
  if (!state.funding) {
    await progress(
      "funding",
      "Mining valueless LAVE-Q for eight 1,000-unit local collateral outputs",
    );
    for (let attempt = 0; attempt < 25; attempt++) {
      const balance = await rpc("controller", "getbalances", [], "controller");
      if (Number(balance.mine.trusted) >= 8101) break;
      await mine(state, 100, { ids: ["controller"] });
    }
    if (
      Number(
        (await rpc("controller", "getbalances", [], "controller")).mine.trusted,
      ) < 8101
    )
      throw new Error("Insufficient isolated test coin funding");
    state.funding = {};
    await saveState(state);
  }
  for (const id of MN_IDS) {
    if (state.funding[id] && !state.masternodes[id].registration) {
      const utxo = await rpc("controller", "gettxout", [
        state.funding[id].txid,
        0,
      ]);
      if (utxo) await setCoinLock(state.funding[id].txid, 0, true);
    }
  }
  for (const id of MN_IDS) {
    if (!state.funding[id]) {
      state.funding[id] = await preparePayment([
        { [state.masternodes[id].funds]: "1000.1" },
      ]);
      await saveState(state);
    }
    await broadcastPrepared(state.funding[id]);
    if (!state.masternodes[id].registration)
      await setCoinLock(state.funding[id].txid, 0, true);
    await mine(state, 1, { ids: ["controller"] });
  }
  for (const id of MN_IDS) {
    const mn = state.masternodes[id];
    if (!mn.registration) {
      await progress(
        "registration",
        `Preparing deterministic masternode ${id}`,
      );
      await setCoinLock(state.funding[id].txid, 0, false);
      const raw = await rpc(
        "controller",
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
        "controller",
        45000,
      );
      const decoded = await rpc("controller", "decoderawtransaction", [raw]);
      mn.registration = { raw, txid: decoded.txid };
      mn.proTxHash = decoded.txid;
      await saveState(state);
    }
    await broadcastPrepared(mn.registration);
  }
  await mine(state, 2, { ids: ["controller"] });
}
export async function startMonitor() {
  await mkdir(PUBLIC_DIR, { recursive: true, mode: 0o700 });
  const exists = async (path) => {
    try {
      await access(path);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  const lock = join(RUNTIME, "monitor.lock");
  if (await exists(join(RUNTIME, "stop-monitor"))) {
    await waitFor(
      async () => !(await exists(lock)),
      "Previous lab monitor did not stop",
      30000,
    );
  }
  const heartbeat = await readJson(join(PUBLIC_DIR, "monitor.json"));
  if (await exists(lock)) {
    if (heartbeat && Date.now() - Date.parse(heartbeat.observedAt) < 15000)
      return;
    throw new Error(
      "Lab monitor lock is stale; inspect monitor.log and the owned process before removing it",
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
    "New lab monitor did not publish its first heartbeat",
    30000,
  );
}
export async function startLab() {
  await verifyLaveRuntime({ daemonPath: DAEMON });
  const state = await loadState();
  await saveState(state);
  await progress(
    "starting",
    "Starting the separate loopback-only LAVE-Q controller",
  );
  await startNode("controller", state);
  await ensureWallet();
  if (state.miningAddress) {
    const ownership = await rpc(
      "controller",
      "getaddressinfo",
      [state.miningAddress],
      "controller",
    );
    if (ownership.ismine !== true)
      throw new Error(
        "Controller wallet does not own the persisted lab mining address",
      );
  }
  await startMonitor();
  if (!MN_IDS.every((id) => state.masternodes[id]?.registration))
    await prepareRegistrations(state);
  else {
    let registrationPending = false;
    for (const id of MN_IDS) {
      await broadcastPrepared(state.masternodes[id].registration);
      const transaction = await rpc("controller", "getrawtransaction", [
        state.masternodes[id].proTxHash,
        true,
      ]);
      registrationPending ||= !(transaction.confirmations > 0);
    }
    if (registrationPending) await mine(state, 2, { ids: ["controller"] });
    for (const id of MN_IDS) {
      const info = await rpc("controller", "protx", [
        "info",
        state.masternodes[id].proTxHash,
      ]);
      if (info.state.pubKeyOperator !== state.masternodes[id].publicKey)
        throw new Error(`Operator identity mismatch for ${id}`);
    }
  }
  await progress(
    "synchronizing",
    "Starting eight registered masternodes and synchronizing their local chains",
  );
  await Promise.all(MN_IDS.map((id) => startNode(id, state)));
  await connectNodes();
  await setClock(state, 1);
  if (!state.initializedAt) {
    await mine(state, 8, { pace: 1100 });
    state.initializedAt = new Date().toISOString();
    await saveState(state);
  } else {
    // A post-sync tip notification restores active quorum connection tracking
    // after process restart. Initial chain loading can finish before mnsync.
    await mine(state, 1, { pace: 1100 });
  }
  await progress(
    "registered",
    "Eight local deterministic masternodes are registered; waiting for DKG commitments",
  );
  return state;
}
export async function stopLab() {
  await progress(
    "stopping",
    "Stopping only the isolated LAVE-Q masternode laboratory",
  );
  await Promise.all(MN_IDS.map(stopNode));
  await stopNode("controller");
  await writeFile(join(RUNTIME, "stop-monitor"), "stop\n", { mode: 0o600 });
  await progress(
    "stopped",
    "Isolated masternode laboratory stopped; persistent state retained",
  );
}
export async function mineQuorums(state) {
  await progress(
    "dkg",
    "Forming small test quorums through real distributed key generation",
  );
  const initial = await rpc("controller", "quorum", ["list", 4]);
  if (
    initial[QUORUMS.chainLocks.name]?.length &&
    initial[QUORUMS.instantSend.name]?.length >= 2
  )
    return;
  // Rotation builds four historical quarters. Advance complete cycles with phase pacing,
  // rather than skipping messages between contributions and commitments.
  for (let block = 0; block < 192; block++) {
    await mine(state, 1, { pace: 1100 });
    const height = await rpc("controller", "getblockcount");
    if (height % 24 === 0 || height % 24 === 1) {
      await waitFor(
        async () => {
          await setClock(state, 1);
          const all = await Promise.all(
            MN_IDS.map((id) => rpc(id, "quorum", ["dkgstatus"])),
          );
          return all.every((status) =>
            (status.quorumConnections || [])
              .filter((q) =>
                ["llmq_test", "llmq_test_dip0024"].includes(q.llmqType),
              )
              .every((q) =>
                (q.quorumConnections || []).every((peer) => peer.connected),
              ),
          );
        },
        "Masternode quorum connections did not authenticate",
        90000,
        1000,
      );
    }
    await waitFor(
      async () => {
        await setClock(state, 1);
        const all = await Promise.all(
          MN_IDS.map((id) => rpc(id, "quorum", ["dkgstatus"])),
        );
        return all.every((status) =>
          (status.session || [])
            .filter((s) =>
              ["llmq_test", "llmq_test_dip0024"].includes(s.llmqType),
            )
            .every((s) => {
              const connections = (status.quorumConnections || []).find(
                (q) =>
                  q.llmqType === s.llmqType && q.quorumIndex === s.quorumIndex,
              )?.quorumConnections;
              const members = (connections?.length || 0) + 1;
              if (s.status.phase === 2)
                return s.status.receivedContributions >= members;
              if (
                s.status.phase === 5 &&
                members >= (s.llmqType === "llmq_test" ? 3 : 4)
              )
                return s.status.receivedPrematureCommitments >= members;
              return true;
            }),
        );
      },
      "DKG contributions or commitments did not arrive",
      60000,
      500,
    );
    if (height % 24 === 0)
      await progress(
        "dkg",
        `DKG cycle at height ${height}; collecting contributions from eight local masternodes`,
      );
    if (height % 24 === 21) {
      const list = await rpc("controller", "quorum", ["list", 4]);
      if (
        list[QUORUMS.chainLocks.name]?.length &&
        list[QUORUMS.instantSend.name]?.length >= 2
      ) {
        await mine(state, 8, { pace: 1100 });
        await progress(
          "ready",
          "ChainLocks and rotated InstantSend test quorums are mined and mature",
        );
        return;
      }
    }
  }
  throw new Error(
    "Real DKG did not produce both required quorum types; inspect quorum dkgstatus and isolated debug logs",
  );
}
