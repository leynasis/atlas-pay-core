import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE, NETWORK_IDENTITY } from "../lab/config.mjs";
import { getPaymentMasternodeStatus } from "../lab/payment-masternodes.mjs";
const now = Date.UTC(2026, 8, 20);
const snapshot = {
  network: NETWORK_IDENTITY,
  observedAt: new Date(now).toISOString(),
  enabledNodes: 16,
  totalNodes: 16,
  capabilities: { instantSend: true, chainLocks: true },
  latestChainLock: {
    height: 5000,
    blockhash: "a".repeat(64),
    signatureVerified: true,
  },
};
test("payment capabilities require a fresh pinned public snapshot and actual ChainLock evidence", async () => {
  const read = async (path) => {
    assert.ok(path.endsWith("/public/status.json"));
    return snapshot;
  };
  const fresh = await getPaymentMasternodeStatus({ read, now });
  assert.equal(fresh.capabilities.instantSend, PROFILE === "lave");
  assert.equal(fresh.capabilities.chainLocks, PROFILE === "lave");
  for (const variant of [
    null,
    { ...snapshot, observedAt: new Date(now - 15001).toISOString() },
    { ...snapshot, observedAt: new Date(now + 5001).toISOString() },
    {
      ...snapshot,
      network: { ...NETWORK_IDENTITY, genesisHash: "b".repeat(64) },
    },
  ]) {
    const result = await getPaymentMasternodeStatus({
      read: async () => variant,
      now,
    });
    assert.equal(result.capabilities.instantSend, false);
    assert.equal(result.capabilities.chainLocks, false);
  }
  for (const latestChainLock of [
    null,
    { ...snapshot.latestChainLock, signatureVerified: "true" },
    { ...snapshot.latestChainLock, blockhash: "bad" },
  ]) {
    const result = await getPaymentMasternodeStatus({
      read: async () => ({ ...snapshot, latestChainLock }),
      now,
    });
    assert.equal(result.capabilities.chainLocks, false);
  }
});
