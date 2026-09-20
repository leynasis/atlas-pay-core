import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkProfile, profileIdentity } from "../lab/profiles.mjs";
import { validateRequest, requestDigest } from "../signer/policy.mjs";

const configUrl = new URL("../lab/config.mjs", import.meta.url).href;
function loadConfig(profile) {
  const env = { ...process.env };
  delete env.LAVEPAY_NETWORK;
  if (profile !== undefined) env.LAVEPAY_NETWORK = profile;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const config = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config));`,
    ],
    { env, encoding: "utf8" },
  );
}

test("LAVE is the default and all wallets, journals, credentials and ports stay separate from Atlas", () => {
  const lave = JSON.parse(loadConfig().stdout);
  const atlas = JSON.parse(loadConfig("atlas").stdout);
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  assert.equal(lave.PROFILE, "lave");
  assert.equal(lave.CURRENCY, "LAVE");
  assert.equal(atlas.CURRENCY, "DASH");
  assert.equal(
    lave.MERCHANT_DB_PATH,
    join(runtime, "lave/merchant/invoices.sqlite"),
  );
  assert.equal(
    atlas.MERCHANT_DB_PATH,
    join(runtime, "merchant/invoices.sqlite"),
  );
  assert.equal(lave.SIGNER_DIR, join(runtime, "lave/signer"));
  assert.equal(atlas.SIGNER_DIR, join(runtime, "signer"));
  assert.equal(lave.LAB_DAEMON_PATH, join(runtime, "lave-core/bin/laved"));
  assert.match(atlas.LAB_DAEMON_PATH, /dashcore-23\.1\.8\/bin\/dashd$/);
  const paths = [
    "datadir",
    "cookiePath",
    "configPath",
    "pidPath",
    "dashboardCredentialsPath",
  ];
  for (const id of atlas.NODE_IDS) {
    for (const path of paths)
      assert.notEqual(lave.NODES[id][path], atlas.NODES[id][path]);
    assert.notEqual(lave.NODES[id].rpcPort, atlas.NODES[id].rpcPort);
    assert.notEqual(lave.NODES[id].p2pPort, atlas.NODES[id].p2pPort);
  }
  assert.notEqual(lave.GENESIS_HASH, atlas.GENESIS_HASH);
  assert.notEqual(lave.DEVNET_GENESIS_HASH, atlas.DEVNET_GENESIS_HASH);
});

test("Network selection rejects typos and inherited production-network names before opening files", () => {
  for (const value of [
    "",
    "LAVE",
    "main",
    "testnet",
    "regtest",
    "__proto__",
    "../atlas",
  ]) {
    const result = loadConfig(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LAVEPAY_NETWORK must be exactly/);
  }
});

test("LAVE requests bind currency and both genesis hashes; legacy Atlas request checksums remain valid", () => {
  const atlas = profileIdentity(networkProfile("atlas"));
  const lave = profileIdentity(networkProfile());
  assert.equal(Object.hasOwn(atlas, "currency"), false);
  assert.equal(lave.currency, "LAVE");
  const now = Date.now();
  const base = {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    merchantName: "LAVEPAY",
    description: "Local test payment",
    address: "L" + "a".repeat(33),
    amount: "0.25",
    amountSats: "25000000",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  };
  for (const [identity, other] of [
    [atlas, lave],
    [lave, atlas],
  ]) {
    const request = { ...base, network: identity };
    request.requestHash = requestDigest(request);
    assert.equal(validateRequest(request, identity, now), 25000000n);
    assert.throws(() => validateRequest(request, other, now), {
      code: "WRONG_NETWORK",
    });
  }
  const changedCurrency = { ...base, network: { ...lave, currency: "DASH" } };
  changedCurrency.requestHash = requestDigest(changedCurrency);
  assert.throws(() => validateRequest(changedCurrency, lave, now), {
    code: "WRONG_NETWORK",
  });
});
