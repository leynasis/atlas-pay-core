import { join } from "node:path";
import {
  NAME,
  CHAIN,
  CURRENCY,
  PUBLIC_DIR,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  NODE_IDS,
  MN_IDS,
} from "./config.mjs";
import { readJson } from "./state.mjs";
export async function getMasternodeStatus({
  readSnapshot = readJson,
  now = Date.now(),
} = {}) {
  const snapshot = await readSnapshot(join(PUBLIC_DIR, "status.json"));
  if (
    snapshot &&
    snapshot.chain === CHAIN &&
    snapshot.genesisHash === GENESIS_HASH &&
    snapshot.devnetGenesisHash === DEVNET_GENESIS_HASH
  ) {
    const stale =
      !Number.isFinite(Date.parse(snapshot.observedAt)) ||
      now - Date.parse(snapshot.observedAt) > 15000 ||
      Date.parse(snapshot.observedAt) > now + 5000;
    return {
      ...snapshot,
      stale,
      capabilities: {
        ...snapshot.capabilities,
        instantSendVerified:
          !stale && snapshot.capabilities?.instantSendVerified === true,
        chainLocksVerified:
          !stale && snapshot.capabilities?.chainLocksVerified === true,
      },
    };
  }
  return {
    name: NAME,
    chain: CHAIN,
    currency: CURRENCY,
    localOnly: true,
    configured: false,
    stale: true,
    observedAt: null,
    genesisHash: GENESIS_HASH,
    devnetGenesisHash: DEVNET_GENESIS_HASH,
    expectedMasternodes: MN_IDS.length,
    totalNodes: NODE_IDS.length,
    onlineNodes: 0,
    registeredMasternodes: 0,
    enabledMasternodes: 0,
    synchronized: false,
    commonHeight: null,
    nodes: [],
    quorums: { chainLocks: [], instantSend: [] },
    chainLock: null,
    capabilities: {
      activationConfigured: true,
      instantSendVerified: false,
      chainLocksVerified: false,
    },
    bootstrap: await readSnapshot(join(PUBLIC_DIR, "bootstrap.json")),
    verification: null,
  };
}
