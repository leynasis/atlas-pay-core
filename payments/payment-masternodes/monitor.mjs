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
import { rpcAmount, formatAmount } from "../server/money.mjs";

import { connectedQuorumMembers } from "./availability.mjs";

const rewardCache = new Map();
async function rewardProof(registration, id) {
  const height = registration.state?.lastPaidHeight;
  if (!Number.isInteger(height) || height <= 0) return null;
  const blockHash = await rpc("miner", "getblockhash", [height]);
  const key = `${registration.proTxHash}:${blockHash}`;
  if (rewardCache.has(key)) return rewardCache.get(key);
  const block = await rpc("miner", "getblock", [blockHash, 2]);
  const coinbase = block.tx[0];
  const address = registration.state.payoutAddress;
  const paid = coinbase.vout.filter(
    (output) =>
      output.scriptPubKey.address === address ||
      output.scriptPubKey.addresses?.includes(address),
  );
  const amount = paid.reduce(
    (sum, output) => sum + rpcAmount(output.value),
    0n,
  );
  const proof = {
    id,
    proTxHash: registration.proTxHash,
    height,
    blockHash,
    txid: coinbase.txid,
    payoutAddress: address,
    amount: formatAmount(amount),
    verified: amount > 0n && typeof coinbase.vin[0].coinbase === "string",
  };
  rewardCache.set(key, proof);
  if (rewardCache.size > 128)
    rewardCache.delete(rewardCache.keys().next().value);
  return proof;
}

export async function collectStatus() {
  const authenticatedPeers = {};
  const nodes = await Promise.all(
    NODE_IDS.map(async (id) => {
      try {
        const chain = await assertNode(id);
        const [peers, sync, masternode] = await Promise.all([
          rpc(id, "getpeerinfo"),
          rpc(id, "mnsync", ["status"]),
          !MN_IDS.includes(id)
            ? null
            : rpc(id, "masternode", ["status"]).catch(() => null),
        ]);
        authenticatedPeers[id] = peers
          .map((peer) => peer.verified_proregtx_hash)
          .filter(Boolean);
        return {
          id,
          role: NODES[id].role,
          online: true,
          height: chain.blocks,
          peerCount: peers.length,
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
  const rewardProofs = [];
  if (nodes[0].identityVerified) {
    const registrations = await rpc("miner", "protx", ["list", "valid", true]);
    const counts = await rpc("miner", "masternode", ["count"]);
    registeredMasternodes = counts.total;
    enabledMasternodes = counts.enabled;
    for (const node of nodes.filter((node) => node.proTxHash)) {
      const registration = registrations.find(
        (mn) => mn.proTxHash === node.proTxHash,
      );
      if (registration) {
        const proof = await rewardProof(registration, node.id);
        if (proof) rewardProofs.push(proof);
      }
    }
    const lists = await rpc("miner", "quorum", ["list", 4]);
    for (const [key, params] of Object.entries(QUORUMS))
      for (const hash of lists[params.name] || []) {
        const info = await rpc("miner", "quorum", [
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
      const lock = await rpc("miner", "getbestchainlock");
      const verified = await rpc("miner", "verifychainlock", [
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
  const available = Object.fromEntries(
    Object.entries(QUORUMS).map(([key, params]) => {
      for (const quorum of quorums[key])
        quorum.observedConnectedMembers = connectedQuorumMembers(
          quorum,
          nodes,
          authenticatedPeers,
        );
      const active = quorums[key].slice(0, params.active);
      return [
        key,
        active.length >= (key === "instantSend" ? 2 : 1) &&
          active.every(
            (quorum) => quorum.observedConnectedMembers >= params.threshold,
          ),
      ];
    }),
  );
  let lastInstantSendProof = null;
  const recorded = verification?.instantSend;
  if (nodes[0].identityVerified && recorded?.verified === true) {
    try {
      const signatureVerified = await rpc("miner", "verifyislock", [
        recorded.requestId,
        recorded.txid,
        recorded.signature,
      ]);
      if (signatureVerified)
        lastInstantSendProof = { ...recorded, signatureVerified };
    } catch {
      /* An unavailable/expired quorum must not advertise fresh proof. */
    }
  }
  const instantSendVerified =
    available.instantSend && lastInstantSendProof?.signatureVerified === true;
  const chainLocksVerified =
    available.chainLocks &&
    chainLock?.verified === true &&
    chainLock.height === nodes[0].height;
  return {
    name: NAME,
    chain: CHAIN,
    currency: CURRENCY,
    networkIdentity: {
      chain: CHAIN,
      devnetName: NAME,
      genesisHash: GENESIS_HASH,
      devnetGenesisHash: DEVNET_GENESIS_HASH,
      currency: CURRENCY,
    },
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
    enabledNodes: enabledMasternodes,
    synchronized:
      onlineNodes === NODE_IDS.length &&
      allHeights.size === 1 &&
      nodes.every((node) => node.synchronized),
    commonHeight:
      allHeights.size === 1 ? nodes.find((node) => node.online)?.height : null,
    nodes,
    quorums,
    chainLock,
    latestChainLock: chainLock
      ? {
          height: chainLock.height,
          blockhash: chainLock.blockHash,
          signature: chainLock.signature,
          signatureVerified: chainLock.verified,
        }
      : null,
    lastInstantSendProof,
    rewardProofs,
    capabilities: {
      activationConfigured: true,
      instantSendVerified,
      chainLocksVerified,
      instantSend: instantSendVerified,
      chainLocks: chainLocksVerified,
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
          "Payment masternode snapshot collection failed; prior snapshot will become stale",
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
