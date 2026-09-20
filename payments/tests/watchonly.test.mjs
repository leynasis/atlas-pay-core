import test from "node:test";
import assert from "node:assert/strict";
import { publicImports, descriptorIdentity } from "../lab/cashier.mjs";
import { NODES, ROLE_NODES, ROLE_WALLETS, PROFILE } from "../lab/config.mjs";

test("Cashier public imports preserve historical derivation indices and cannot rewind an existing address pool", () => {
  const descriptors = [
    {
      desc: "external-public",
      timestamp: 1,
      active: true,
      internal: false,
      range: [0, 1000],
      next_index: 14,
    },
    {
      desc: "internal-public",
      timestamp: 1,
      active: true,
      internal: true,
      range: [0, 1000],
      next_index: 2,
    },
  ];
  const prior = [{ ...descriptors[0], range: [0, 2000], next_index: 37 }];
  assert.deepEqual(publicImports(descriptors, prior), [
    {
      desc: "external-public",
      timestamp: 0,
      active: true,
      internal: false,
      range: [0, 2000],
      next_index: 37,
    },
    {
      desc: "internal-public",
      timestamp: 0,
      active: true,
      internal: true,
      range: [0, 1000],
      next_index: 2,
    },
  ]);
  assert.equal(
    descriptorIdentity(descriptors),
    descriptorIdentity(
      descriptors
        .toReversed()
        .map((item) => ({ ...item, next_index: 500, range: [0, 5000] })),
    ),
  );
  assert.notEqual(
    descriptorIdentity(descriptors),
    descriptorIdentity([
      { ...descriptors[0], desc: "unrelated-public" },
      descriptors[1],
    ]),
  );
});

test("LAVE role mapping gives the cashier and private refund signer different daemons and wallets", () => {
  assert.equal(ROLE_WALLETS.merchant, "merchant");
  if (PROFILE === "lave") {
    assert.equal(NODES.merchant.wallet, "cashier");
    assert.equal(ROLE_NODES.merchant, "signer");
    assert.equal(NODES.signer.wallet, "merchant");
    assert.notEqual(NODES.merchant.cookiePath, NODES.signer.cookiePath);
    assert.notEqual(NODES.merchant.rpcPort, NODES.signer.rpcPort);
  } else {
    assert.equal(NODES.merchant.wallet, "merchant");
    assert.equal(ROLE_NODES.merchant, "merchant");
    assert.equal(Object.hasOwn(NODES, "signer"), false);
  }
});
