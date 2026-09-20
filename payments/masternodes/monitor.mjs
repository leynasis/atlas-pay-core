import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  NAME,
  CHAIN,
  CURRENCY,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  NODE_IDS,
  MN_IDS,
  NODES,
  PUBLIC_DIR,
  RUNTIME,
  QUORUMS,
} from "./config.mjs";
import { rpc, assertNode } from "./rpc.mjs";
import { readJson, writeJson } from "./state.mjs";

export async function collectStatus() {
  const nodes = await Promise.all(
    NODE_IDS.map(async (id) => {
      try {
        const chain = await assertNode(id);
        const [peers, sync, masternode] = await Promise.all([
          rpc(id, "getconnectioncount"),
          rpc(id, "mnsync", ["status"]),
          id === "controller"
            ? null
            : rpc(id, "masternode", ["status"]).catch(() => null),
        ]);
        return {
          id,
          role: NODES[id].role,
          online: true,
          height: chain.blocks,
          peerCount: peers,
          identityVerified: true,
          synchronized: sync.IsSynced === true,
          state: masternode?.state || null,
          proTxHash: masternode?.proTxHash || null,
        };
      } catch {
        return {
          id,
          role: NODES[id].role,
          online: false,
          height: null,
          peerCount: 0,
          identityVerified: false,
          state: null,
          proTxHash: null,
        };
      }
    }),
  );
  let registeredMasternodes = 0,
    enabledMasternodes = 0,
    chainLock = null;
  const quorums = { chainLocks: [], instantSend: [] };
  if (nodes[0].identityVerified) {
    const registrations = await rpc("controller", "protx", [
      "list",
      "valid",
      true,
    ]);
    registeredMasternodes = registrations.length;
    enabledMasternodes = registrations.filter(
      (mn) => mn.state?.PoSeBanHeight === -1,
    ).length;
    const lists = await rpc("controller", "quorum", ["list", 4]);
    for (const [key, params] of Object.entries(QUORUMS))
      for (const hash of lists[params.name] || []) {
        const info = await rpc("controller", "quorum", [
          "info",
          params.type,
          hash,
          false,
        ]);
        quorums[key].push({
          hash,
          height: info.height,
          validMembers: info.members.filter((member) => member.valid).length,
          size: params.size,
          threshold: params.threshold,
          members: info.members.map((member) => ({
            proTxHash: member.proTxHash,
            valid: member.valid,
          })),
        });
      }
    try {
      const lock = await rpc("controller", "getbestchainlock");
      const verified = await rpc("controller", "verifychainlock", [
        lock.blockhash,
        lock.signature,
        lock.height,
      ]);
      chainLock = {
        height: lock.height,
        blockHash: lock.blockhash,
        signature: lock.signature,
        verified,
      };
    } catch {
      /* No ChainLock exists before the first successful DKG. */
    }
  }
  const verification = await readJson(join(PUBLIC_DIR, "verification.json"));
  const onlineNodes = nodes.filter((node) => node.online).length;
  const allHeights = new Set(
    nodes.filter((node) => node.online).map((node) => node.height),
  );
  return {
    name: NAME,
    chain: CHAIN,
    currency: CURRENCY,
    localOnly: true,
    observedAt: new Date().toISOString(),
    configured: true,
    stale: false,
    genesisHash: GENESIS_HASH,
    devnetGenesisHash: DEVNET_GENESIS_HASH,
    expectedMasternodes: MN_IDS.length,
    totalNodes: NODE_IDS.length,
    onlineNodes,
    registeredMasternodes,
    enabledMasternodes,
    synchronized:
      onlineNodes === NODE_IDS.length &&
      allHeights.size === 1 &&
      nodes.every((node) => node.synchronized),
    commonHeight:
      allHeights.size === 1 ? nodes.find((node) => node.online)?.height : null,
    nodes,
    quorums,
    chainLock,
    capabilities: {
      activationConfigured: true,
      instantSendVerified:
        onlineNodes === NODE_IDS.length &&
        verification?.instantSend?.verified === true,
      chainLocksVerified:
        onlineNodes === NODE_IDS.length &&
        chainLock?.verified === true &&
        chainLock.height === nodes[0].height,
    },
    bootstrap: await readJson(join(PUBLIC_DIR, "bootstrap.json")),
    verification,
  };
}
export async function publishStatus() {
  const status = await collectStatus();
  await writeJson(join(PUBLIC_DIR, "status.json"), status);
  return status;
}
async function monitor() {
  const lock = join(RUNTIME, "monitor.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
  try {
    for (;;) {
      try {
        await access(join(RUNTIME, "stop-monitor"));
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await publishStatus();
      } catch {
        console.error(
          "Masternode snapshot collection failed; prior snapshot will become stale",
        );
      }
      await writeJson(join(PUBLIC_DIR, "monitor.json"), {
        pid: process.pid,
        observedAt: new Date().toISOString(),
      });
      await delay(3000);
    }
    await publishStatus();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await monitor();
