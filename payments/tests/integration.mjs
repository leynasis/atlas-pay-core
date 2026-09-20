import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { rpc, assertRegtest } from "../network/rpc.mjs";
import { RUNTIME_DIR } from "../network/config.mjs";
import { join } from "node:path";
import { parseAmount } from "../server/money.mjs";

const base = "http://127.0.0.1:4180";
const results = [];
async function api(
  path,
  { method = "GET", body, key, expected = [200, 201], origin } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${response.status} ${path}: ${JSON.stringify(result)}`,
  );
  return result;
}
function check(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}
async function mine() {
  return api("/api/dev/mine", { method: "POST", body: { blocks: 1 } });
}

await assertRegtest();
const status = await api("/api/status");
assert.equal(status.network, "regtest");
assert.equal(status.connected, true);
assert.equal(status.capabilities.instantSend, false);
check("Connected to isolated regtest; InstantSend is not claimed");

await api("/api/invoices", {
  method: "POST",
  key: randomUUID(),
  expected: 403,
  origin: "https://untrusted.example",
  body: {
    amount: "0.125",
    description: "Blocked cross-origin request",
    merchantName: "Test",
    expiresInMinutes: 60,
  },
});
check("Cross-origin mutation rejected");

await api("/api/invoices", {
  method: "POST",
  key: randomUUID(),
  expected: 400,
  body: {
    amount: "0.000000001",
    description: "Invalid precision",
    merchantName: "Test",
    expiresInMinutes: 60,
  },
});
check("Sub-satoshi input rejected");

const key = randomUUID();
const payload = {
  amount: "0.125",
  description: "Integration payment",
  merchantName: "Atlas Test Store",
  expiresInMinutes: 60,
};
const before = (await api("/api/invoices")).invoices.length;
const createdResponse = await fetch(`${base}/api/invoices`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": key },
  body: JSON.stringify(payload),
});
assert.ok([200, 201].includes(createdResponse.status));
const { invoice } = await createdResponse.json();
assert.equal(parseAmount(invoice.amount), 12_500_000n);
assert.equal(invoice.status, "pending");
const retry = await api("/api/invoices", {
  method: "POST",
  body: payload,
  key,
});
assert.equal(retry.invoice.id, invoice.id);
assert.equal((await api("/api/invoices")).invoices.length, before + 1);
await api("/api/invoices", {
  method: "POST",
  body: { ...payload, amount: "0.25" },
  key,
  expected: 409,
});
check("Invoice creation persists and rejects conflicting idempotency reuse");

const qr = await fetch(`${base}/api/invoices/${invoice.id}/qr`);
assert.equal(qr.status, 200);
assert.match(qr.headers.get("content-type"), /image\/svg\+xml/);
assert.match(await qr.text(), /<svg/);
assert.ok(invoice.paymentUri.includes(invoice.address));
check("Checkout QR and payment URI available");

const payKey = randomUUID();
const [payment, repeatedPayment] = await Promise.all([
  api(`/api/invoices/${invoice.id}/pay`, {
    method: "POST",
    body: {},
    key: payKey,
  }),
  api(`/api/invoices/${invoice.id}/pay`, {
    method: "POST",
    body: {},
    key: payKey,
  }),
]);
assert.match(payment.txid, /^[a-f0-9]{64}$/);
assert.equal(repeatedPayment.txid, payment.txid);
const detected = (await api(`/api/invoices/${invoice.id}`)).invoice;
assert.equal(detected.status, "detected");
assert.equal(parseAmount(detected.confirmedAmount, { allowZero: true }), 0n);
check("Real payment detected; repeated request returns same transaction");

await mine();
const paid = (await api(`/api/invoices/${invoice.id}`)).invoice;
assert.equal(paid.status, "paid");
assert.equal(parseAmount(paid.confirmedAmount), 12_500_000n);
const merchantTx = await rpc("gettransaction", [payment.txid], "merchant");
assert.ok(merchantTx.confirmations >= 1);
assert.ok(
  merchantTx.details.some(
    (detail) =>
      detail.address === invoice.address && detail.category === "receive",
  ),
);
check("Paid status independently verified against merchant wallet transaction");

const refundKey = randomUUID();
const refund = await api(`/api/invoices/${invoice.id}/refund`, {
  method: "POST",
  body: {},
  key: refundKey,
});
assert.match(refund.txid, /^[a-f0-9]{64}$/);
assert.notEqual(refund.txid, payment.txid);
const repeatedRefund = await api(`/api/invoices/${invoice.id}/refund`, {
  method: "POST",
  body: {},
  key: refundKey,
});
assert.equal(repeatedRefund.txid, refund.txid);
await mine();
assert.equal(
  (await api(`/api/invoices/${invoice.id}`)).invoice.status,
  "refunded",
);
const payerRefund = await rpc("gettransaction", [refund.txid], "payer");
assert.ok(payerRefund.confirmations >= 1);
assert.ok(payerRefund.details.some((detail) => detail.category === "receive"));
check("Refund is a distinct confirmed transaction received by the test payer");

const partial = (
  await api("/api/invoices", {
    method: "POST",
    key: randomUUID(),
    body: {
      ...payload,
      amount: "0.05",
      description: "Partial, overpayment and reorganization test",
    },
  })
).invoice;
await rpc(
  "sendtoaddress",
  [partial.address, "0.02", "atlas-integration-partial"],
  "payer",
);
const underpaid = (await api(`/api/invoices/${partial.id}`)).invoice;
assert.equal(underpaid.status, "partial");
assert.equal(parseAmount(underpaid.receivedAmount), 2_000_000n);
check("Partial payment remains partial");

await rpc(
  "sendtoaddress",
  [partial.address, "0.04", "atlas-integration-overpayment"],
  "payer",
);
await mine();
const overpaid = (await api(`/api/invoices/${partial.id}`)).invoice;
assert.equal(overpaid.status, "paid");
assert.equal(overpaid.overpaid, true);
assert.equal(parseAmount(overpaid.confirmedAmount), 6_000_000n);
check("Multiple transactions reconcile exactly and flag overpayment");

const confirmedTip = await rpc("getbestblockhash");
await rpc("invalidateblock", [confirmedTip]);
try {
  const reorg = (await api(`/api/invoices/${partial.id}`)).invoice;
  assert.notEqual(reorg.status, "paid");
  assert.equal(parseAmount(reorg.confirmedAmount, { allowZero: true }), 0n);
  check(
    "Block invalidation removes paid status instead of leaving stale settlement",
  );
} finally {
  await rpc("reconsiderblock", [confirmedTip]);
}
assert.equal((await api(`/api/invoices/${partial.id}`)).invoice.status, "paid");
check("Reconsidered block restores confirmed payment");

await rpc(
  "sendtoaddress",
  [invoice.address, "0.001", "atlas-integration-post-refund"],
  "payer",
);
await mine();
const lateReceipt = (await api(`/api/invoices/${invoice.id}`)).invoice;
assert.equal(lateReceipt.requiresReview, true);
assert.equal(parseAmount(lateReceipt.additionalReceivedAfterRefund), 100_000n);
assert.equal(parseAmount(lateReceipt.refundAmount), 12_500_000n);
await api(`/api/invoices/${invoice.id}/refund`, {
  method: "POST",
  body: {},
  key: randomUUID(),
  expected: 409,
});
check(
  "New funds after refund are visibly flagged and never silently refunded twice",
);

const report = {
  testedAt: new Date().toISOString(),
  upstream: "v23.1.8",
  network: "regtest",
  results,
  invoiceId: invoice.id,
  paymentTxid: payment.txid,
  refundTxid: refund.txid,
};
await mkdir(RUNTIME_DIR, { recursive: true });
await writeFile(
  join(RUNTIME_DIR, "integration-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `\n${results.length} integration checks passed on real Dash regtest transactions.`,
);
