import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROFILE, RUNTIME_DIR, NETWORK_IDENTITY } from "./config.mjs";

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

// The cashier only receives this explicitly public projection. It never reads
// operator keys, private journals, or an administrative masternode RPC cookie.
export async function getPaymentMasternodeStatus({
  read = readSnapshot,
  now = Date.now(),
} = {}) {
  const empty = {
    available: false,
    stale: true,
    localOnly: true,
    currency: "LAVE",
    observedAt: null,
    enabledNodes: 0,
    totalNodes: 0,
    capabilities: { instantSend: false, chainLocks: false },
    latestChainLock: null,
    quorums: { chainLocks: [], instantSend: [] },
  };
  if (PROFILE !== "lave") return empty;
  const snapshot = await read(
    join(RUNTIME_DIR, "payment-masternodes", "public", "status.json"),
  );
  const identity = snapshot?.network || snapshot;
  if (
    !snapshot ||
    ["chain", "genesisHash", "devnetGenesisHash"].some(
      (key) => identity[key] !== NETWORK_IDENTITY[key],
    )
  )
    return empty;
  const time = Date.parse(snapshot.observedAt);
  const stale =
    !Number.isFinite(time) || now - time > 15000 || time > now + 5000;
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : 0;
  const lock = snapshot.latestChainLock;
  const validLock =
    lock &&
    Number.isSafeInteger(lock.height) &&
    /^[0-9a-f]{64}$/.test(lock.blockhash) &&
    lock.signatureVerified === true;
  return {
    ...empty,
    available: true,
    stale,
    observedAt: snapshot.observedAt,
    enabledNodes: count(snapshot.enabledNodes),
    totalNodes: count(snapshot.registeredMasternodes ?? snapshot.totalNodes),
    latestChainLock: validLock
      ? {
          height: lock.height,
          blockhash: lock.blockhash,
          signatureVerified: !stale,
        }
      : null,
    quorums: {
      chainLocks: Array.isArray(snapshot.quorums?.chainLocks)
        ? snapshot.quorums.chainLocks.slice(0, 4)
        : [],
      instantSend: Array.isArray(snapshot.quorums?.instantSend)
        ? snapshot.quorums.instantSend.slice(0, 2)
        : [],
    },
    capabilities: {
      instantSend: !stale && snapshot.capabilities?.instantSend === true,
      chainLocks:
        !stale &&
        validLock === true &&
        snapshot.capabilities?.chainLocks === true,
    },
  };
}
