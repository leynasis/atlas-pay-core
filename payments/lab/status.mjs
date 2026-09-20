import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  CURRENCY,
  PROFILE,
  DEVNET_GENESIS_HASH,
  GENESIS_HASH,
  LAB_NAME,
  NODE_IDS,
  NODES,
} from "./config.mjs";
import { inspectNode, readOnlyRpc } from "./rpc.mjs";
import { getPaymentMasternodeStatus } from "./payment-masternodes.mjs";

export async function getLabStatus() {
  let configured = true;
  for (const node of Object.values(NODES)) {
    try {
      await access(node.dashboardCredentialsPath);
    } catch {
      configured = false;
    }
  }
  const nodes = await Promise.all(
    NODE_IDS.map(async (id) => {
      const node = NODES[id];
      const base = {
        id,
        label: node.label,
        online: false,
        height: null,
        bestBlockHash: null,
        peerCount: null,
        peers: [],
        identityVerified: false,
        error: null,
      };
      try {
        const info = await inspectNode(id, readOnlyRpc);
        return {
          ...base,
          online: true,
          height: info.blocks,
          bestBlockHash: info.bestblockhash,
          peerCount: info.peers.length,
          identityVerified: true,
          peers: info.peers.map((peer) => ({
            nodeId:
              Object.values(NODES).find(
                (other) => `127.0.0.1:${other.p2pPort}` === peer.addr,
              )?.id || null,
            address: peer.addr,
            inbound: peer.inbound,
          })),
        };
      } catch (error) {
        return {
          ...base,
          error: error.message.includes("identity mismatch")
            ? "Named devnet identity verification failed."
            : error.message.includes("isolation")
              ? "Peer isolation verification failed."
              : "Node unavailable, inactive, or dashboard credentials not configured.",
        };
      }
    }),
  );
  const online = nodes.filter((node) => node.online);
  const synchronized =
    online.length === NODE_IDS.length &&
    online.every(
      (node) =>
        node.bestBlockHash === online[0].bestBlockHash &&
        node.height === online[0].height,
    );
  const paymentMasternodes = await getPaymentMasternodeStatus();
  return {
    name: LAB_NAME,
    profile: PROFILE,
    currency: CURRENCY,
    mode: "devnet",
    localOnly: true,
    configured,
    observedAt: new Date().toISOString(),
    expectedNodes: NODE_IDS.length,
    onlineNodes: online.length,
    synchronized,
    commonHeight: synchronized ? online[0].height : null,
    commonTip: synchronized ? online[0].bestBlockHash : null,
    genesisHash: GENESIS_HASH,
    devnetGenesisHash: DEVNET_GENESIS_HASH,
    capabilities: synchronized
      ? paymentMasternodes.capabilities
      : { instantSend: false, chainLocks: false },
    paymentMasternodes,
    nodes,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  getLabStatus().then((status) => {
    console.log(JSON.stringify(status, null, 2));
    if (status.onlineNodes !== NODE_IDS.length || !status.synchronized)
      process.exitCode = 1;
  });
}
