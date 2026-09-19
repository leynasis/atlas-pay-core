import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CustomerSigner, createPaymentRequest } from "../signer/service.mjs";
import { SignerStore } from "../signer/store.mjs";
import {
  inspectPsbt,
  requestDigest,
  validateRequest,
} from "../signer/policy.mjs";
import { labContext } from "../signer/runtime.mjs";
import { rpc, assertLabNode } from "../lab/rpc.mjs";
import { waitUntil, mineBlocks } from "../lab/lifecycle.mjs";
import { rpcAmount, formatAmount } from "../server/money.mjs";

const results = [];
function passed(label) {
  results.push(label);
  console.log(`PASS ${label}`);
}
const customer = await labContext("customer");
const merchant = await labContext("merchant");
await Promise.all(
  ["miner", "merchant", "customer"].map((node) => assertLabNode(node)),
);
const runtime = fileURLToPath(new URL("../.runtime/signer/", import.meta.url));
await mkdir(runtime, { recursive: true, mode: 0o700 });
const dbPath = `${runtime}integration.sqlite`;
let store = new SignerStore(dbPath);
let sendCount = 0;
let signCount = 0;
let simulateLostResponse = true;
const observedRpc = async (node, method, params, wallet) => {
  if (method === "walletprocesspsbt" && params[1] === true) signCount++;
  if (method === "sendrawtransaction") {
    sendCount++;
    const result = await customer.rpc(node, method, params, wallet);
    if (simulateLostResponse) {
      simulateLostResponse = false;
      throw new Error("Integration-only simulated loss after real broadcast");
    }
    return result;
  }
  return customer.rpc(node, method, params, wallet);
};
let signer = new CustomerSigner({ ...customer, rpc: observedRpc, store });
try {
  const request = await createPaymentRequest({
    ...merchant,
    amount: "0.25",
    merchantName: "Atlas Signing Lab",
    description: "Customer-controlled signing integration",
    expiresInMinutes: 60,
  });
  assert.equal(
    (await rpc("merchant", "getaddressinfo", [request.address], "merchant"))
      .ismine,
    true,
  );
  assert.equal(
    (await rpc("customer", "getaddressinfo", [request.address], "customer"))
      .ismine,
    false,
  );
  passed(
    "Merchant receiving key belongs to merchant node, not customer wallet",
  );
  const review = await signer.prepare(request);
  assert.equal(review.amount, "0.25");
  assert.equal(review.state, "prepared");
  assert.equal(sendCount, 0);
  assert.equal(signCount, 0);
  assert.deepEqual(await signer.prepare(request), review);
  passed(
    "Real unsigned PSBT prepared with exact amount, owned inputs/change and bounded fee",
  );
  for (const [field, value] of [
    ["amount", "0.5"],
    ["address", review.changeAddress],
  ])
    await assert.rejects(
      signer.prepare({ ...request, [field]: value }),
      (error) => error.code === "REQUEST_CHANGED",
    );
  const wrongNetwork = {
    ...request,
    network: { ...request.network, devnetGenesisHash: "f".repeat(64) },
  };
  wrongNetwork.requestHash = requestDigest(wrongNetwork);
  assert.throws(
    () => validateRequest(wrongNetwork, customer.identity),
    (error) => error.code === "WRONG_NETWORK",
  );
  assert.throws(
    () =>
      validateRequest(
        request,
        customer.identity,
        Date.parse(request.expiresAt),
      ),
    (error) => error.code === "REQUEST_EXPIRED",
  );
  passed(
    "Amount/address import tampering, wrong devnet and expired requests rejected",
  );
  const record = store.get(request.id);
  const decoded = await rpc("customer", "decodepsbt", [record.psbt]);
  const baseOutputs = decoded.tx.vout.map((output) => ({
    [output.scriptPubKey.address]: formatAmount(rpcAmount(output.value)),
  }));
  const destinationIndex = decoded.tx.vout.findIndex(
    (output) => output.scriptPubKey.address === request.address,
  );
  const changeIndex = decoded.tx.vout.findIndex(
    (output) => output.scriptPubKey.address === review.changeAddress,
  );
  assert.ok(destinationIndex >= 0 && changeIndex >= 0);
  const unexpectedAddress = await rpc(
    "merchant",
    "getnewaddress",
    ["signer-tampering-test"],
    "merchant",
  );
  async function alteredPsbt(outputs) {
    const inputs = decoded.tx.vin.map(({ txid, vout, sequence }) => ({
      txid,
      vout,
      sequence,
    }));
    const blank = await rpc("customer", "createpsbt", [inputs, outputs, 0]);
    return (
      await rpc(
        "customer",
        "walletprocesspsbt",
        [blank, false, "ALL", false, false],
        "customer",
      )
    ).psbt;
  }
  async function rejectPsbt(outputs, expected) {
    const psbt = await alteredPsbt(outputs);
    await assert.rejects(
      inspectPsbt({
        request,
        psbt,
        changeAddress: review.changeAddress,
        identity: customer.identity,
        rpc: customer.rpc,
        expectedTemplateHash: record.templateHash,
      }),
      (error) => error.code === expected,
    );
  }
  const amountChanged = structuredClone(baseOutputs);
  amountChanged[destinationIndex][request.address] = "0.26";
  await rejectPsbt(amountChanged, "AMOUNT_CHANGED");
  const changeStolen = structuredClone(baseOutputs);
  changeStolen[changeIndex] = {
    [unexpectedAddress]: baseOutputs[changeIndex][review.changeAddress],
  };
  await rejectPsbt(changeStolen, "UNOWNED_CHANGE");
  const destinationChanged = structuredClone(baseOutputs);
  destinationChanged[destinationIndex] = {
    [unexpectedAddress]: request.amount,
  };
  await rejectPsbt(destinationChanged, "UNOWNED_CHANGE");
  const feeChanged = structuredClone(baseOutputs);
  feeChanged[changeIndex][review.changeAddress] = formatAmount(
    rpcAmount(baseOutputs[changeIndex][review.changeAddress]) - 1_000_000n,
  );
  await rejectPsbt(feeChanged, "EXCESSIVE_FEE");
  passed(
    "Actual altered PSBTs with changed recipient, amount, change and excessive fees rejected",
  );
  await assert.rejects(
    signer.approve(request.id, async () => false),
    (error) => error.code === "APPROVAL_DENIED",
  );
  assert.equal(signCount, 0);
  assert.equal(sendCount, 0);
  passed(
    "Declining the customer review produces no signature and no broadcast",
  );
  let approvalCount = 0;
  await assert.rejects(
    signer.approve(request.id, async (actualReview) => {
      approvalCount++;
      assert.equal(actualReview.fingerprint, review.fingerprint);
      return true;
    }),
    (error) => error.code === "BROADCAST_UNCERTAIN",
  );
  assert.equal(store.get(request.id).state, "broadcast_unknown");
  store.close();
  store = new SignerStore(dbPath);
  signer = new CustomerSigner({ ...customer, rpc: observedRpc, store });
  const result = await signer.approve(request.id, async () => {
    throw new Error(
      "Already broadcast transaction must reconcile without a second approval/signature",
    );
  });
  assert.equal(result.state, "broadcast");
  assert.equal(sendCount, 1);
  assert.equal(signCount, 1);
  assert.equal(approvalCount, 1);
  assert.deepEqual(await signer.approve(request.id, async () => false), result);
  passed(
    "Real customer signature and transaction recover after simulated lost response and SQLite restart without duplicate broadcast",
  );
  await waitUntil(
    async () => (await rpc("miner", "getrawmempool")).includes(result.txid),
    "Customer transaction did not reach miner",
  );
  await mineBlocks(1);
  await waitUntil(async () => {
    try {
      return (
        (await rpc("merchant", "gettransaction", [result.txid], "merchant"))
          .confirmations >= 1
      );
    } catch {
      return false;
    }
  }, "Merchant did not confirm the signed payment");
  const receipt = await rpc(
    "merchant",
    "gettransaction",
    [result.txid],
    "merchant",
  );
  const received = receipt.details
    .filter(
      (detail) =>
        detail.category === "receive" && detail.address === request.address,
    )
    .reduce((sum, detail) => sum + rpcAmount(detail.amount), 0n);
  assert.equal(received, 25_000_000n);
  passed(
    "Transaction propagated across nodes and merchant independently confirmed exactly 0.25 test DASH",
  );
  const cancellation = await createPaymentRequest({
    ...merchant,
    amount: "0.01",
    merchantName: "Atlas Signing Lab",
    description: "Unsigned cancellation test",
  });
  await signer.prepare(cancellation);
  const cancelInputs = store.get(cancellation.id).outpoints;
  await signer.cancel(cancellation.id);
  const remainingLocks = await rpc(
    "customer",
    "listlockunspent",
    [],
    "customer",
  );
  assert.ok(
    cancelInputs.every(
      (point) =>
        !remainingLocks.some(
          (item) => item.txid === point.txid && item.vout === point.vout,
        ),
    ),
  );
  passed("Unsigned cancellation releases only its selected customer inputs");
  const report = {
    testedAt: new Date().toISOString(),
    network: customer.identity,
    requestId: request.id,
    address: request.address,
    amount: request.amount,
    fee: review.fee,
    fingerprint: review.fingerprint,
    txid: result.txid,
    approvalMode:
      "programmatic integration-test authorization of devnet coins; interactive CLI tested separately",
    results,
  };
  await writeFile(
    `${runtime}integration-report.json`,
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    `\n${results.length} signing integration checks passed. Transaction: ${result.txid}`,
  );
} finally {
  store.close();
}
