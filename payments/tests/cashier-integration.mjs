import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PROFILE,
  NODES,
  NETWORK_IDENTITY,
  EXPECTED_CHAIN,
  RUNTIME_DIR,
  MINER_API_CREDENTIALS_PATH,
} from "../lab/config.mjs";
import { rpc, assertLabNode, merchantReadRpc } from "../lab/rpc.mjs";
import { ensureCashier, descriptorIdentity } from "../lab/cashier.mjs";
import { createMerchantApplication } from "../merchant/index.mjs";

assert.equal(
  PROFILE,
  "lave",
  "Cashier custody test requires the LAVE profile.",
);
await assertLabNode("merchant");
await assertLabNode("signer");
const tip = (await rpc("miner", "getblockchaininfo")).bestblockhash;
const signerBefore = await rpc("signer", "getwalletinfo", [], "merchant");
const migration = join(NODES.signer.datadir, "migration/v05");
const journal = JSON.parse(
  await readFile(join(migration, "state.json"), "utf8"),
);
assert.equal(journal.state, "complete");
assert.deepEqual(journal.network, NETWORK_IDENTITY);
const publicBefore = await rpc(
  "merchant",
  "listdescriptors",
  [false],
  "cashier",
);
await ensureCashier();
const publicAfter = await rpc(
  "merchant",
  "listdescriptors",
  [false],
  "cashier",
);
assert.deepEqual(
  publicAfter,
  publicBefore,
  "Completed migration must not rewind or reimport descriptor indices.",
);
assert.deepEqual(await rpc("merchant", "listwallets"), ["cashier"]);
const cashier = await rpc("merchant", "getwalletinfo", [], "cashier");
assert.equal(cashier.private_keys_enabled, false);
assert.equal(cashier.descriptors, true);
assert.equal(signerBefore.private_keys_enabled, true);
assert.equal(cashier.balance, signerBefore.balance);
assert.equal(
  descriptorIdentity(publicAfter.descriptors),
  descriptorIdentity(
    (await rpc("signer", "listdescriptors", [false], "merchant")).descriptors,
  ),
);
if (journal.migratedExisting) {
  await stat(join(migration, "original-merchant.dat"));
  await stat(join(migration, "original-merchant-wallet", "wallet.dat"));
  for (const root of [
    join(NODES.merchant.datadir, EXPECTED_CHAIN, "wallets"),
    join(NODES.merchant.datadir, EXPECTED_CHAIN),
  ])
    await assert.rejects(stat(join(root, "merchant")), { code: "ENOENT" });
  for (const { address } of journal.addresses) {
    const viewed = await rpc(
      "merchant",
      "getaddressinfo",
      [address],
      "cashier",
    );
    assert.ok(viewed.ismine || viewed.iswatchonly);
    assert.equal(
      (await rpc("signer", "getaddressinfo", [address], "merchant")).ismine,
      true,
    );
  }
}
const destination = await rpc(
  "customer",
  "getnewaddress",
  ["watch-only-signing-test"],
  "customer",
);
const { psbt } = await rpc(
  "signer",
  "walletcreatefundedpsbt",
  [
    [],
    [{ [destination]: "0.0001" }],
    0,
    {
      add_inputs: true,
      lockUnspents: false,
      includeWatching: false,
      fee_rate: "1",
    },
    false,
  ],
  "merchant",
);
const attempted = await rpc(
  "merchant",
  "walletprocesspsbt",
  [psbt, true, "ALL", false, true],
  "cashier",
);
assert.equal(attempted.complete, false);
const decoded = await rpc("merchant", "decodepsbt", [attempted.psbt]);
assert.ok(
  decoded.inputs.every(
    (input) => !Object.keys(input.partial_signatures || {}).length,
  ),
);
assert.equal(
  (await merchantReadRpc("getwalletinfo")).private_keys_enabled,
  false,
);
const minerCredential = JSON.parse(
  await readFile(MINER_API_CREDENTIALS_PATH, "utf8"),
);
for (const method of [
  "sendtoaddress",
  "walletprocesspsbt",
  "dumpprivkey",
  "stop",
]) {
  const response = await fetch(`${NODES.miner.rpcUrl}/wallet/miner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${minerCredential.username}:${minerCredential.password}`).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "cashier-boundary",
      method,
      params: [],
    }),
  });
  assert.equal(response.status, 403);
  await response.text();
}
const app = createMerchantApplication();
let invoiceCount;
try {
  assert.equal((await app.service.status()).capabilities.watchOnly, true);
  const invoices = (await app.service.listInvoices()).invoices;
  invoiceCount = invoices.length;
  assert.ok(invoices.every((invoice) => invoice.currency === "LAVE"));
} finally {
  await app.close();
}
assert.equal((await rpc("miner", "getblockchaininfo")).bestblockhash, tip);
await writeFile(
  join(RUNTIME_DIR, "cashier-integration-report.json"),
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      network: NETWORK_IDENTITY,
      migratedExisting: journal.migratedExisting,
      historicalAddressCount: journal.addresses.length,
      invoiceCount,
      cashierPrivateKeysEnabled: false,
      validPsbtCouldNotBeSigned: true,
      originalsPreservedOutsideCashier: true,
      repeatedMigrationDidNotRewindAddresses: true,
      restrictedMinerRejectedPrivilegedMethods: true,
      noBlocksMined: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "PASS Watch-only cashier cannot sign; historical addresses and wallets preserved; migration replay does not rewind addresses; miner credential cannot spend/sign/export/stop.",
);
