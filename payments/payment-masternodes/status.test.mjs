import test from "node:test";
import assert from "node:assert/strict";
import { getPaymentMasternodeStatus } from "./status.mjs";
import {
  CHAIN,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  NODES,
  MN_IDS,
} from "./config.mjs";
const now = Date.UTC(2026, 8, 20);
const valid = {
  chain: CHAIN,
  genesisHash: GENESIS_HASH,
  devnetGenesisHash: DEVNET_GENESIS_HASH,
  observedAt: new Date(now - 1000).toISOString(),
  capabilities: {
    instantSendVerified: true,
    chainLocksVerified: true,
    instantSend: true,
    chainLocks: true,
  },
};
const readSnapshot = async (path) =>
  path.endsWith("status.json") ? valid : null;
test("unconfigured lab has no verified capability and never asks for RPC", async () => {
  const calls = [];
  const status = await getPaymentMasternodeStatus({
    now,
    readSnapshot: async (path) => {
      calls.push(path);
      return null;
    },
  });
  assert.equal(status.configured, false);
  assert.equal(status.capabilities.instantSendVerified, false);
  assert.equal(status.capabilities.chainLocksVerified, false);
  assert.equal(status.capabilities.instantSend, false);
  assert.equal(status.capabilities.chainLocks, false);
  assert.ok(calls.every((path) => path.includes("/public/")));
});
test("fresh pinned lab snapshot preserves actual proof booleans", async () => {
  const status = await getPaymentMasternodeStatus({ now, readSnapshot });
  assert.equal(status.stale, false);
  assert.equal(status.capabilities.instantSendVerified, true);
  assert.equal(status.capabilities.chainLocksVerified, true);
});
test("stale snapshots cannot advertise either verified capability", async () => {
  const status = await getPaymentMasternodeStatus({
    now: now + 15001,
    readSnapshot,
  });
  assert.equal(status.stale, true);
  assert.equal(status.capabilities.instantSendVerified, false);
  assert.equal(status.capabilities.chainLocksVerified, false);
  assert.equal(status.capabilities.instantSend, false);
  assert.equal(status.capabilities.chainLocks, false);
});
test("future-dated snapshots fail closed", async () => {
  const status = await getPaymentMasternodeStatus({
    now: now - 10000,
    readSnapshot,
  });
  assert.equal(status.stale, true);
  assert.equal(status.capabilities.instantSendVerified, false);
});
test("a different network snapshot cannot be accepted by matching only its display name", async () => {
  for (const field of ["chain", "genesisHash", "devnetGenesisHash"]) {
    const status = await getPaymentMasternodeStatus({
      now,
      readSnapshot: async (path) =>
        path.endsWith("status.json") ? { ...valid, [field]: "foreign" } : null,
    });
    assert.equal(status.configured, false);
    assert.equal(status.capabilities.instantSendVerified, false);
  }
});
test("malformed proof fields never become truthy verification badges", async () => {
  const status = await getPaymentMasternodeStatus({
    now,
    readSnapshot: async () => ({
      ...valid,
      capabilities: { instantSendVerified: "true", chainLocksVerified: 1 },
    }),
  });
  assert.equal(status.capabilities.instantSendVerified, false);
  assert.equal(status.capabilities.chainLocksVerified, false);
  assert.equal(status.capabilities.instantSend, false);
  assert.equal(status.capabilities.chainLocks, false);
});
test("all twenty fixed ports are unique and sixteen seed datadirs are separate from payment nodes", () => {
  assert.equal(Object.keys(NODES).length, 20);
  assert.equal(
    new Set(
      Object.values(NODES).flatMap((node) => [node.rpcPort, node.p2pPort]),
    ).size,
    40,
  );
  assert.ok(
    MN_IDS.map((id) => NODES[id]).every((node) =>
      node.datadir.includes("/.runtime/lave/payment-masternodes/nodes/"),
    ),
  );
});
