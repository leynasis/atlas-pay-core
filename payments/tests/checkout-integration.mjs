import assert from "node:assert/strict";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { rpc } from "../lab/rpc.mjs";
import {
  EXPECTED_CHAIN,
  CURRENCY,
  RUNTIME_DIR,
  MERCHANT_API_CREDENTIALS_PATH,
  NODES,
} from "../lab/config.mjs";
import { parseAmount } from "../server/money.mjs";

// Explicitly spends valueless coins on the pinned local devnet only.
const merchant = "http://127.0.0.1:4173";
const customer = "http://127.0.0.1:4174";
const refundWallet = "http://127.0.0.1:4175";
const results = [];
const check = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
async function api(
  origin,
  path,
  { body, key, session, headers = {}, expected = 200 } = {},
) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: origin }),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${path}: HTTP ${response.status}: ${JSON.stringify(data)}`,
  );
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  return { data, response };
}
async function session(origin) {
  const { data, response } = await api(origin, "/api/wallet/status");
  assert.equal(data.chainAvailable, true);
  assert.equal(data.network.chain, EXPECTED_CHAIN);
  assert.equal(data.currency, CURRENCY);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(data.csrfToken, /^[a-f0-9]{64}$/);
  return { ...data, cookie: cookie.split(";")[0] };
}
async function until(callback, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
const invoice = async (id) =>
  (await api(merchant, `/api/invoices/${id}`)).data.invoice;
async function mineInvoice(id) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await api(merchant, "/api/dev/mine", {
      body: { blocks: 1, invoiceId: id },
      expected: [200, 409],
    });
    if (result.response.status === 200) return result;
    // This explicit retryable response guarantees that no block was mined.
    // Do not retry arbitrary conflicts or hide a failed post-mine receipt check.
    assert.equal(result.data.error?.code, "PAYMENT_NOT_MINEABLE");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "InstantSend did not make the invoice eligible within 90 seconds.",
  );
}
const create = async (amount, description) =>
  (
    await api(merchant, "/api/invoices", {
      body: {
        amount,
        description,
        merchantName: "Atlas HTTP validation",
        expiresInMinutes: 60,
      },
      key: randomUUID(),
      expected: 201,
    })
  ).data.invoice;
const request = (origin, action, body, currentSession) =>
  api(origin, `/api/wallet/${action}`, { body, session: currentSession });

const status = (await api(merchant, "/api/status")).data;
assert.equal(status.network, EXPECTED_CHAIN);
assert.equal(status.currency, CURRENCY);
assert.equal(status.connected, true);
assert.equal(status.capabilities.serverCanSign, false);
const network = (await api(merchant, "/api/lab/status")).data;
assert.equal(network.currency, CURRENCY);
assert.equal(network.onlineNodes, Object.keys(NODES).length);
assert.equal(network.synchronized, true);
const payer = await session(customer);
const seller = await session(refundWallet);
assert.equal(payer.role, "customer");
assert.equal(seller.role, "merchant");
assert.notEqual(payer.cookie.split("=")[0], seller.cookie.split("=")[0]);
check(
  "Configured local nodes and three HTTP apps use the pinned devnet; role sessions are distinct",
);

// Invalid/empty arguments cannot spend or export even if a whitelist regresses.
const credential = JSON.parse(
  await readFile(MERCHANT_API_CREDENTIALS_PATH, "utf8"),
);
for (const method of ["sendtoaddress", "walletprocesspsbt", "dumpprivkey"]) {
  const response = await fetch(
    `${NODES.merchant.rpcUrl}/wallet/${NODES.merchant.wallet}`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "merchant-permission-check",
        method,
        params: [],
      }),
    },
  );
  assert.equal(
    response.status,
    403,
    `Daemon must reject merchant API ${method}`,
  );
  await response.text();
}
check(
  "Core daemon denies merchant API spending, signing and private-key export",
);

const key = randomUUID();
const body = {
  amount: "0.125",
  description: "HTTP checkout and refund",
  merchantName: "Atlas HTTP validation",
  expiresInMinutes: 60,
};
const created = (
  await api(merchant, "/api/invoices", { body, key, expected: 201 })
).data.invoice;
assert.equal(created.currency, CURRENCY);
assert.match(created.paymentUri, new RegExp(`^${CURRENCY.toLowerCase()}:`));
assert.equal(
  (await api(merchant, "/api/invoices", { body, key, expected: 201 })).data
    .invoice.id,
  created.id,
);
assert.equal(
  (
    await api(merchant, "/api/invoices", {
      body: { ...body, amount: "0.25" },
      key,
      expected: 409,
    })
  ).data.error.code,
  "IDEMPOTENCY_CONFLICT",
);
await api(merchant, `/api/invoices/${created.id}/pay`, {
  body: {},
  key: randomUUID(),
  expected: 404,
});
const paymentRequest = (
  await api(merchant, `/api/invoices/${created.id}/request`)
).data;
assert.equal(paymentRequest.id, created.id);
assert.equal(paymentRequest.amount, "0.125");
assert.equal(paymentRequest.network.chain, EXPECTED_CHAIN);
const qr = await api(merchant, `/api/invoices/${created.id}/qr`);
assert.match(qr.response.headers.get("content-type"), /image\/svg/);
check(
  "Invoice creation is idempotent, immutable request and QR exist, merchant API cannot pay",
);

await api(customer, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "payment" },
  headers: { Origin: "http://example.invalid" },
  expected: 403,
});
await api(customer, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "payment" },
  expected: 403,
});
await api(customer, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "payment" },
  session: payer,
  headers: { Origin: "" },
  expected: 403,
});
await api(customer, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "payment" },
  session: payer,
  headers: { "X-CSRF-Token": "0".repeat(64) },
  expected: 403,
});
await api(customer, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "refund" },
  session: payer,
  expected: 409,
});
await api(refundWallet, "/api/wallet/prepare", {
  body: { invoiceId: created.id, kind: "payment" },
  session: seller,
  expected: 409,
});
check(
  "Wallet mutations require exact Origin, matching session and CSRF token, and correct role",
);

const draft = (
  await request(
    customer,
    "prepare",
    { invoiceId: created.id, kind: "payment" },
    payer,
  )
).data.review;
assert.equal(draft.state, "prepared");
assert.equal(draft.txid, null);
assert.equal(draft.address, created.address);
assert.equal(draft.amount, "0.125");
assert.ok(parseAmount(draft.fee) <= 10000n);
assert.equal(
  (
    await request(
      customer,
      "prepare",
      { invoiceId: created.id, kind: "payment" },
      payer,
    )
  ).data.review.fingerprint,
  draft.fingerprint,
);
await api(customer, "/api/wallet/approve", {
  body: { requestId: draft.id, fingerprint: "0".repeat(64) },
  session: payer,
  expected: 409,
});
assert.equal((await invoice(created.id)).receivedAmount, "0");
check(
  "Preparation spends nothing; repeated preparation preserves review; mismatched approval fails",
);

const approved = (
  await request(
    customer,
    "approve",
    { requestId: draft.id, fingerprint: draft.fingerprint },
    payer,
  )
).data.review;
assert.match(approved.txid, /^[a-f0-9]{64}$/);
assert.equal(
  (
    await request(
      customer,
      "approve",
      { requestId: draft.id, fingerprint: draft.fingerprint },
      payer,
    )
  ).data.review.txid,
  approved.txid,
);
await until(
  async () => (await invoice(created.id)).status === "detected",
  "Payment did not reach merchant",
);
const pendingWallet = (
  await api(customer, "/api/wallet/status", { session: payer })
).data;
assert.ok(
  parseAmount(pendingWallet.pendingBalance, { allowZero: true }) >=
    parseAmount(draft.changeAmount, { allowZero: true }),
);
await mineInvoice(created.id);
const paid = await invoice(created.id);
assert.equal(paid.status, "paid");
assert.equal(paid.confirmedAmount, "0.125");
assert.equal(paid.paymentTxid, approved.txid);
assert.equal(
  (
    await request(
      customer,
      "approve",
      { requestId: draft.id, fingerprint: draft.fingerprint },
      payer,
    )
  ).data.review.txid,
  approved.txid,
);
check(
  "Explicit customer approval broadcasts once; miner confirms actual invoice receipt; replay stays the same transaction",
);

const reloaded = await session(customer);
const restored = (
  await api(customer, `/api/wallet/requests/${draft.id}`, { session: reloaded })
).data.review;
assert.equal(restored.txid, approved.txid);
assert.equal(restored.confirmationState, "confirmed");
assert.equal(reloaded.receiveAddress, payer.receiveAddress);
check(
  "A fresh browser session restores saved transaction, confirmations and stable receive address",
);

const refundKey = randomUUID();
const refundBody = { address: payer.receiveAddress };
const refund = (
  await api(merchant, `/api/invoices/${created.id}/refund-request`, {
    body: refundBody,
    key: refundKey,
    expected: 201,
  })
).data;
assert.equal(refund.request.amount, "0.125");
assert.notEqual(refund.request.id, created.id);
assert.equal(
  (
    await api(merchant, `/api/invoices/${created.id}/refund-request`, {
      body: refundBody,
      key: refundKey,
      expected: 201,
    })
  ).data.request.id,
  refund.request.id,
);
await api(merchant, `/api/invoices/${created.id}/refund-request`, {
  body: { address: created.address },
  key: refundKey,
  expected: 409,
});
await api(merchant, `/api/invoices/${created.id}/refund-receipt`, {
  body: { requestId: refund.request.id, txid: approved.txid },
  key: randomUUID(),
  expected: 409,
});
check(
  "Refund destination is explicit and immutable; a payment transaction cannot impersonate a refund",
);

const refundDraft = (
  await request(
    refundWallet,
    "prepare",
    { invoiceId: created.id, kind: "refund" },
    seller,
  )
).data.review;
assert.equal(refundDraft.role, "merchant");
assert.equal(refundDraft.address, payer.receiveAddress);
const sentRefund = (
  await request(
    refundWallet,
    "approve",
    { requestId: refundDraft.id, fingerprint: refundDraft.fingerprint },
    seller,
  )
).data.review;
assert.match(sentRefund.txid, /^[a-f0-9]{64}$/);
assert.notEqual(sentRefund.txid, approved.txid);
await until(async () => {
  await api(refundWallet, `/api/wallet/requests/${refundDraft.id}`, {
    session: seller,
  });
  return (await invoice(created.id)).status === "refund_pending";
}, "Refund receipt did not synchronize");
await mineInvoice(created.id);
const refunded = await invoice(created.id);
assert.equal(refunded.status, "refunded");
assert.equal(refunded.refundTxid, sentRefund.txid);
assert.equal(refunded.refundAmount, "0.125");
const receipt = await rpc(
  "customer",
  "gettransaction",
  [sentRefund.txid],
  "customer",
);
assert.ok(receipt.confirmations >= 1);
assert.equal(
  receipt.details
    .filter(
      (detail) =>
        detail.category === "receive" &&
        detail.address === payer.receiveAddress,
    )
    .reduce((sum, detail) => sum + parseAmount(detail.amount), 0n),
  parseAmount("0.125"),
);
assert.equal(
  (
    await request(
      refundWallet,
      "approve",
      { requestId: refundDraft.id, fingerprint: refundDraft.fingerprint },
      seller,
    )
  ).data.review.txid,
  sentRefund.txid,
);
check(
  "Merchant wallet signs separate refund; receipt is verified and customer actually receives exact amount once",
);

const cancelInvoice = await create("0.02", "Cancel unsigned browser draft");
const cancelDraft = (
  await request(
    customer,
    "prepare",
    { invoiceId: cancelInvoice.id, kind: "payment" },
    payer,
  )
).data.review;
assert.equal(
  (await request(customer, "cancel", { requestId: cancelDraft.id }, payer)).data
    .review.state,
  "cancelled",
);
assert.equal((await invoice(cancelInvoice.id)).receivedAmount, "0");
check(
  "Cancelling an unsigned request releases its reservation without spending",
);

const partialInvoice = await create(
  "0.05",
  "External partial receipt blocks browser approval",
);
const partialDraft = (
  await request(
    customer,
    "prepare",
    { invoiceId: partialInvoice.id, kind: "payment" },
    payer,
  )
).data.review;
// Test-only administrator RPC simulates a payment arriving from another wallet.
await rpc("miner", "sendtoaddress", [partialInvoice.address, "0.01"], "miner");
await until(
  async () => (await invoice(partialInvoice.id)).status === "partial",
  "External partial receipt was not detected",
);
const rejected = await api(customer, "/api/wallet/approve", {
  body: { requestId: partialDraft.id, fingerprint: partialDraft.fingerprint },
  session: payer,
  expected: 409,
});
assert.equal(rejected.data.error.code, "PARTIAL_PAYMENT_REVIEW");
assert.equal(
  (await api(customer, `/api/wallet/requests/${partialDraft.id}`)).data.review
    .txid,
  null,
);
await request(customer, "cancel", { requestId: partialDraft.id }, payer);
await mineInvoice(partialInvoice.id);
check(
  "Fresh invoice check refuses a stale full payment after an external partial receipt",
);

await writeFile(
  join(RUNTIME_DIR, "checkout-integration-report.json"),
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      results,
      invoiceId: created.id,
      paymentTxid: approved.txid,
      refundTxid: sentRefund.txid,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `${results.length} checkout integration checks passed. Test invoices remain available for inspection.`,
);
