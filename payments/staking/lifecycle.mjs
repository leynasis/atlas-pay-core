import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { networkProfile } from "../lab/profiles.mjs";
import { verifyLaveRuntime } from "../lab/runtime.mjs";
import { parseRpcJson } from "../server/rpc.mjs";
import { requirePolicy } from "../signer/policy.mjs";
import { IDENTITY, PEER_PORTS, stakingConfig } from "./config.mjs";
const exec = promisify(execFile);
const offline = (error) =>
  error.code === "ENOENT" ||
  error.cause?.code === "ECONNREFUSED" ||
  error.code === "ECONNREFUSED";

// Cookie removal happens before Core flushes its databases and releases the
// datadir lock. A restart is safe only once the actual process has exited.
export async function waitForManagedExit({
  pid,
  pidPath,
  isOffline,
  read = readFile,
  sleep = delay,
  attempts = 240,
  probe = (value) => process.kill(value, 0),
}) {
  requirePolicy(
    Number.isSafeInteger(pid) && pid > 1,
    "INVALID_NODE_PID",
    "Managed node PID is invalid.",
  );
  for (let attempt = 0; attempt < attempts; attempt++) {
    let fileAbsent = false,
      processAbsent = false;
    try {
      await read(pidPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") fileAbsent = true;
      else throw error;
    }
    try {
      probe(pid);
    } catch (error) {
      if (error.code === "ESRCH") processAbsent = true;
      else throw error;
    }
    if (fileAbsent && processAbsent && (await isOffline())) return;
    await sleep(250);
  }
  requirePolicy(
    false,
    "NODE_STOP_PENDING",
    "Managed node is still stopping. Collateral remains reserved.",
  );
}
export function managedNode(role) {
  const config = stakingConfig(role);
  async function savedPid() {
    let text;
    try {
      text = (await readFile(config.pidPath, "utf8")).trim();
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    requirePolicy(
      /^\d+$/.test(text) &&
        Number.isSafeInteger(Number(text)) &&
        Number(text) > 1,
      "INVALID_NODE_PID",
      "Managed node PID is invalid.",
    );
    return Number(text);
  }
  const awaitExit = (pid) =>
    waitForManagedExit({
      pid,
      pidPath: config.pidPath,
      isOffline: async () => !(await inspect()).online,
    });
  async function rpc(method, params = []) {
    const cookie = (await readFile(config.cookie, "utf8")).trim();
    const response = await fetch(`http://127.0.0.1:${config.rpcPort}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "lave-wallet-masternode",
        method,
        params,
      }),
    });
    const result = parseRpcJson(await response.text());
    requirePolicy(
      response.ok && !result.error && Object.hasOwn(result, "result"),
      "NODE_RPC_FAILED",
      "Managed masternode RPC failed.",
    );
    return result.result;
  }
  async function inspect() {
    try {
      const [chain, genesis, named, peers] = await Promise.all([
        rpc("getblockchaininfo"),
        rpc("getblockhash", [0]),
        rpc("getblockhash", [1]),
        rpc("getpeerinfo"),
      ]);
      requirePolicy(
        chain.chain === IDENTITY.chain &&
          genesis === IDENTITY.genesisHash &&
          named === IDENTITY.devnetGenesisHash,
        "WRONG_NETWORK",
        "Managed node is not on the pinned LAVE chain.",
      );
      for (const peer of peers)
        requirePolicy(
          /^127\.0\.0\.1:\d+$/.test(peer.addr) &&
            (peer.inbound ||
              PEER_PORTS.some((port) => peer.addr === `127.0.0.1:${port}`)) &&
            (!peer.subver ||
              peer.subver
                .split(/[();\s]+/)
                .includes(`devnet.${IDENTITY.chain}`)),
          "FOREIGN_PEER",
          "Managed masternode has a peer outside the local allowlist.",
        );
      const [info, sync] = await Promise.all([
        rpc("masternode", ["status"]),
        rpc("mnsync", ["status"]),
      ]);
      return {
        online: true,
        blockHeight: chain.blocks,
        bestblockhash: chain.bestblockhash,
        masternodeState: info.state,
        masternodeSynced: sync.IsSynced === true,
        peerCount: peers.filter((peer) => peer.subver).length,
        proTxHash: info.proTxHash || null,
      };
    } catch (error) {
      if (offline(error))
        return {
          online: false,
          blockHeight: null,
          bestblockhash: null,
          masternodeState: null,
          masternodeSynced: false,
          peerCount: 0,
          proTxHash: null,
        };
      throw error;
    }
  }
  async function start(node, target) {
    requirePolicy(
      node.service === config.service &&
        /^[0-9a-f]{64}$/.test(node.operator?.secret),
      "INVALID_OPERATOR",
      "Managed operator configuration is invalid.",
    );
    await verifyLaveRuntime();
    const running = await inspect();
    if (running.online) {
      requirePolicy(
        !running.proTxHash || running.proTxHash === node.proTxHash,
        "NODE_IDENTITY_MISMATCH",
        "Another masternode is already running in this role.",
      );
      return running;
    }
    const stoppingPid = await savedPid();
    if (stoppingPid !== null) await awaitExit(stoppingPid);
    await mkdir(config.datadir, { recursive: true, mode: 0o700 });
    const text = [
      `devnet=${IDENTITY.devnetName}`,
      "server=1",
      "disablewallet=1",
      "dnsseed=0",
      "fixedseeds=0",
      "dns=0",
      "discover=0",
      "listenonion=0",
      "upnp=0",
      "natpmp=0",
      "dbcache=32",
      "par=1",
      `masternodeblsprivkey=${node.operator.secret}`,
      "[devnet]",
      "listen=1",
      "rpcbind=127.0.0.1",
      "rpcallowip=127.0.0.1",
      `rpcport=${config.rpcPort}`,
      `port=${config.p2pPort}`,
      `bind=${config.service}`,
      `externalip=${config.service}`,
      "addnode=127.0.0.1:20011",
      "",
    ].join("\n");
    await writeFile(config.conf, text, { mode: 0o600 });
    await chmod(config.conf, 0o600);
    try {
      await exec(
        networkProfile("lave").daemonPath,
        [`-datadir=${config.datadir}`, `-conf=${config.conf}`, "-daemonwait=1"],
        { timeout: 90000, maxBuffer: 1024 * 1024 },
      );
    } catch {
      requirePolicy(
        false,
        "NODE_START_FAILED",
        "The managed local masternode could not start; inspect its private local log.",
      );
    }
    if (target) {
      let synchronized = false;
      for (let attempt = 0; attempt < 240; attempt++) {
        const own = await inspect();
        if (own.online && own.blockHeight >= target.height) {
          requirePolicy(
            (await rpc("getblockhash", [target.height])) === target.hash,
            "WRONG_NETWORK",
            "Managed node did not reproduce the approving wallet chain.",
          );
          synchronized = true;
          break;
        }
        await delay(250);
      }
      requirePolicy(
        synchronized,
        "NODE_SYNC_PENDING",
        "Managed node is still synchronizing; collateral remains reserved.",
      );
    }
    // Local development orchestration: advance only after the actual chain has
    // caught up. No blocks, commitments or signatures are fabricated here.
    for (let attempt = 0; attempt < 12; attempt++) {
      if ((await rpc("mnsync", ["status"])).IsSynced) break;
      await rpc("mnsync", ["next"]);
    }
    return inspect();
  }
  async function stop(node) {
    const state = await inspect();
    const pid = await savedPid();
    if (!state.online) {
      if (pid !== null) await awaitExit(pid);
      return state;
    }
    requirePolicy(
      !state.proTxHash || state.proTxHash === node.proTxHash,
      "NODE_IDENTITY_MISMATCH",
      "Refusing to stop a different operator.",
    );
    requirePolicy(
      pid !== null,
      "INVALID_NODE_PID",
      "Online managed node has no PID file; refusing an unsafe restart.",
    );
    await rpc("stop");
    await awaitExit(pid);
    return inspect();
  }
  return { config, inspect, start, stop };
}
