import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { MerchantService } from "../merchant/service.mjs";
import { MerchantStore } from "../merchant/store.mjs";
import { createMerchantHttpServer } from "../merchant/http.mjs";
import { requestDigest, canonical } from "../signer/policy.mjs";

const NOW = Date.UTC(2026, 8, 20);
const identity = {
  chain: "devnet-atlas-local-v1",
  devnetName: "atlas-local-v1",
  genesisHash: "0".repeat(64),
  devnetGenesisHash: "1".repeat(64),
};
const input = {
  amount: "0.25",
  merchantName: "Atlas",
  description: "Order #1042",
  expiresInMinutes: 60,
};
const destination = "yCustomer11111111111111111111111111";
const code = (value) => (error) => error.code === value;

class MerchantNode {
  constructor() {
    this.addresses = new Set();
    this.txs = new Map();
    this.calls = [];
    this.mempool = new Set();
    this.counter = 0;
    this.now = NOW;
    this.wrongChain = false;
    this.offline = false;
    this.mineCalls = [];
  }
  assertNetwork = async () => {
    if (this.offline) throw new Error("Sensitive credentials must not leak");
    return {
      ...identity,
      chain: this.wrongChain ? "main" : identity.chain,
      blocks: 123,
    };
  };
  newAddress() {
    const address = `y${String(++this.counter).padStart(33, "1")}`;
    this.addresses.add(address);
    return address;
  }
  receive(address, amount, confirmations = 0) {
    const txid = (++this.counter).toString(16).padStart(64, "0");
    this.txs.set(txid, {
      txid,
      time: Math.floor(this.now / 1000),
      confirmations,
      details: [{ category: "receive", address, amount }],
    });
    if (confirmations === 0) this.mempool.add(txid);
    return txid;
  }
  outgoing(address, amount, confirmations = 0) {
    const txid = (++this.counter).toString(16).padStart(64, "0");
    const change = this.newAddress();
    this.txs.set(txid, {
      txid,
      time: Math.floor(this.now / 1000),
      confirmations,
      fee: "-0.00000226",
      amount: `-${amount}`,
      details: [{ category: "send", address, amount: `-${amount}` }],
      decoded: {
        txid,
        type: 0,
        vout: [
          {
            value: amount,
            scriptPubKey: { address, hex: `script-${address}` },
          },
          {
            value: "1",
            scriptPubKey: { address: change, hex: `script-${change}` },
          },
        ],
      },
    });
    if (confirmations === 0) this.mempool.add(txid);
    return txid;
  }
  rpc = async (method, params = []) => {
    this.calls.push({ method, params });
    if (this.offline) throw new Error("Sensitive RPC token");
    switch (method) {
      case "getbalance":
        return "2.375";
      case "getnewaddress":
        return this.newAddress();
      case "listreceivedbyaddress":
        assert.equal(params[1], false);
        return [
          {
            address: params[4],
            txids: [...this.txs.values()]
              .filter((tx) =>
                tx.details.some(
                  (detail) =>
                    detail.category === "receive" &&
                    detail.address === params[4],
                ),
              )
              .map((tx) => tx.txid),
          },
        ];
      case "gettransaction": {
        const tx = this.txs.get(params[0]);
        if (!tx) throw Object.assign(new Error("Unknown"), { code: -5 });
        return structuredClone(tx);
      }
      case "getaddressinfo":
        return { ismine: this.addresses.has(params[0]) };
      case "validateaddress":
        return { isvalid: true, scriptPubKey: `script-${params[0]}` };
      case "getmempoolentry":
        if (this.mempool.has(params[0])) return {};
        throw Object.assign(new Error("Not in mempool"), { code: -5 });
      default:
        throw new Error(`Forbidden or unexpected method ${method}`);
    }
  };
  mine = async (args) => {
    this.mineCalls.push(args);
    return { blockHeight: 124, synchronized: true };
  };
}
function setup(t, { path = ":memory:", node = new MerchantNode() } = {}) {
  const store = new MerchantStore(path);
  t.after(() => store.close());
  const service = new MerchantService({
    store,
    identity,
    rpc: node.rpc,
    assertNetwork: node.assertNetwork,
    now: () => node.now,
    mineDevelopment: node.mine,
  });
  return { store, service, node };
}

test("Merchant invoices have one address, exact immutable signer request and durable idempotency", async (t) => {
  const { service, node } = setup(t);
  const key = randomUUID();
  const [one, duplicate] = await Promise.all([
    service.createInvoice(input, key),
    service.createInvoice(
      {
        description: input.description,
        expiresInMinutes: 60,
        amount: "0.25",
        merchantName: "Atlas",
      },
      key,
    ),
  ]);
  assert.deepEqual(one, duplicate);
  assert.equal(one.invoice.amountSats, "25000000");
  const request = await service.paymentRequest(one.invoice.id);
  assert.equal(request.id, one.invoice.id);
  assert.equal(request.requestHash, requestDigest(request));
  assert.deepEqual(request.network, identity);
  assert.deepEqual(await service.paymentRequest(one.invoice.id), request);
  assert.equal(
    node.calls.filter((call) => call.method === "getnewaddress").length,
    1,
  );
  assert.equal(
    one.invoice.checkoutUrl,
    `http://127.0.0.1:4173/pay/${one.invoice.id}`,
  );
  assert.ok(!Object.keys(one.invoice).some((field) => field.startsWith("_")));
  await assert.rejects(
    service.createInvoice({ ...input, amount: "0.5" }, key),
    code("IDEMPOTENCY_CONFLICT"),
  );
  assert.throws(
    () => service.createInvoice({ ...input, amount: 0.25 }, randomUUID()),
    code("INVALID_AMOUNT"),
  );
  assert.throws(
    () =>
      service.createInvoice(
        { ...input, merchantName: "Atlas\x1b[2J" },
        randomUUID(),
      ),
    code("INVALID_INPUT"),
  );
});

test("Partial, paid, late and reorganized receipts are reconciled without changing a payment request", async (t) => {
  const { service, node } = setup(t);
  const { invoice } = await service.createInvoice(
    { ...input, expiresInMinutes: 1 },
    randomUUID(),
  );
  const original = await service.paymentRequest(invoice.id);
  const first = node.receive(invoice.address, "0.1", 1);
  let view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.status, "partial");
  assert.equal(view.requiresReview, true);
  assert.equal(view.canRequestRefund, true);
  assert.equal(view.paymentRequestAvailable, false);
  await assert.rejects(
    service.paymentRequest(invoice.id),
    code("PARTIAL_PAYMENT_REVIEW"),
  );
  node.now += 60_001;
  await assert.rejects(
    service.paymentRequest(invoice.id),
    code("INVOICE_EXPIRED"),
  );
  const second = node.receive(invoice.address, "0.16", 0);
  view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.status, "detected");
  assert.equal(view.receivedAmount, "0.26");
  assert.equal(view.overpaid, true);
  assert.equal(view.canRequestRefund, false);
  node.txs.get(second).confirmations = 1;
  assert.equal((await service.getInvoice(invoice.id)).invoice.status, "paid");
  node.txs.get(second).confirmations = -1;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "partial",
  );
  node.txs.get(first).confirmations = -1;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "expired",
  );
  assert.equal(original.amount, "0.25");
  assert.equal(original.id, invoice.id);
});

test("Full refund requests require explicit external destination and confirmed receipts; new funds invalidate review", async (t) => {
  const { service, node } = setup(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  const payment = node.receive(invoice.address, "0.27");
  await assert.rejects(
    service.createRefundRequest(
      invoice.id,
      { address: destination },
      randomUUID(),
    ),
    code("PAYMENT_UNCONFIRMED"),
  );
  node.txs.get(payment).confirmations = 1;
  await assert.rejects(
    service.createRefundRequest(
      invoice.id,
      { address: destination, amount: "0.25" },
      randomUUID(),
    ),
    code("FULL_REFUND_REQUIRED"),
  );
  await assert.rejects(
    service.createRefundRequest(
      invoice.id,
      { address: invoice.address },
      randomUUID(),
    ),
    code("INVALID_REFUND_ADDRESS"),
  );
  const key = randomUUID();
  const prepared = await service.createRefundRequest(
    invoice.id,
    { address: destination },
    key,
  );
  assert.equal(prepared.request.amount, "0.27");
  assert.notEqual(prepared.request.id, invoice.id);
  assert.equal(prepared.invoice.status, "paid");
  assert.equal(prepared.invoice.refundTxid, null);
  assert.equal(prepared.invoice.refundAmount, "0");
  assert.equal(prepared.invoice.refundRequestStatus, "awaiting_approval");
  assert.deepEqual(
    await service.createRefundRequest(
      invoice.id,
      { address: destination },
      key,
    ),
    prepared,
  );
  assert.equal(
    (await service.refundRequest(invoice.id)).request.requestHash,
    prepared.request.requestHash,
  );
  await assert.rejects(
    service.paymentRequest(invoice.id),
    code("REFUND_IN_PROGRESS"),
  );
  node.receive(invoice.address, "0.01", 1);
  await assert.rejects(
    service.refundRequest(invoice.id),
    code("REFUND_TOTAL_CHANGED"),
  );
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.refundRequestStatus,
    "review",
  );
  await assert.rejects(
    service.createRefundRequest(
      invoice.id,
      { address: destination },
      randomUUID(),
    ),
    code("REFUND_REQUEST_EXISTS"),
  );
});

test("Refund receipts require independent outgoing proof and reject forgery, stale transactions and duplicate allocation", async (t) => {
  const { service, node } = setup(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  const payment = node.receive(invoice.address, "0.25", 1);
  const { request } = await service.createRefundRequest(
    invoice.id,
    { address: destination },
    randomUUID(),
  );
  const register = (txid) =>
    service.registerRefundReceipt(
      invoice.id,
      { requestId: request.id, txid },
      randomUUID(),
    );
  await assert.rejects(register(payment), code("INVALID_REFUND_TRANSACTION"));
  await assert.rejects(
    register("f".repeat(64)),
    code("REFUND_TRANSACTION_NOT_FOUND"),
  );
  const wrongAmount = node.outgoing(destination, "0.2");
  await assert.rejects(
    register(wrongAmount),
    code("INVALID_REFUND_TRANSACTION"),
  );
  const wrongAddress = node.outgoing(
    "yOther111111111111111111111111111111",
    "0.25",
  );
  await assert.rejects(
    register(wrongAddress),
    code("INVALID_REFUND_TRANSACTION"),
  );
  const stale = node.outgoing(destination, "0.25");
  node.txs.get(stale).time -= 2;
  await assert.rejects(register(stale), code("INVALID_REFUND_TRANSACTION"));
  const stolenChange = node.outgoing(destination, "0.25");
  node.txs.get(stolenChange).decoded.vout[1].scriptPubKey.address = destination;
  await assert.rejects(
    register(stolenChange),
    code("INVALID_REFUND_TRANSACTION"),
  );
  const dropped = node.outgoing(destination, "0.25");
  node.mempool.delete(dropped);
  await assert.rejects(register(dropped), code("REFUND_NOT_BROADCAST"));
  const actual = node.outgoing(destination, "0.25");
  const receiptKey = randomUUID();
  const registered = await service.registerRefundReceipt(
    invoice.id,
    { requestId: request.id, txid: actual },
    receiptKey,
  );
  assert.equal(registered.invoice.status, "refund_pending");
  assert.equal(registered.invoice.refundAmount, "0.25");
  assert.deepEqual(
    await service.registerRefundReceipt(
      invoice.id,
      { requestId: request.id, txid: actual },
      receiptKey,
    ),
    registered,
  );
  await assert.rejects(register(wrongAmount), code("REFUND_RECEIPT_CONFLICT"));
  node.txs.get(actual).confirmations = 1;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "refunded",
  );
  node.txs.get(actual).confirmations = -1;
  let view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.status, "refund_pending");
  assert.equal(view.requiresReview, true);
  node.txs.get(actual).confirmations = 1;
  node.receive(invoice.address, "0.01", 1);
  view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.additionalReceivedAfterRefund, "0.01");
  assert.equal(view.requiresReview, true);
  const secondInvoice = (await service.createInvoice(input, randomUUID()))
    .invoice;
  node.receive(secondInvoice.address, "0.25", 1);
  const secondRequest = (
    await service.createRefundRequest(
      secondInvoice.id,
      { address: destination },
      randomUUID(),
    )
  ).request;
  await assert.rejects(
    service.registerRefundReceipt(
      secondInvoice.id,
      { requestId: secondRequest.id, txid: actual },
      randomUUID(),
    ),
    code("REFUND_RECEIPT_CONFLICT"),
  );
  assert.ok(
    node.calls.every(
      (call) => !/send|sign|walletprocess|dump|export/i.test(call.method),
    ),
  );
});

test("Receipt registration retries transient RPC and visibility failures with the same bound key", async (t) => {
  const { service, node, store } = setup(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  node.receive(invoice.address, "0.25", 1);
  const { request } = await service.createRefundRequest(
    invoice.id,
    { address: destination },
    randomUUID(),
  );
  const txid = node.outgoing(destination, "0.25");
  const body = { requestId: request.id, txid };
  const key = randomUUID();
  let failOnce = true;
  service.rpc = async (method, params) => {
    if (method === "listreceivedbyaddress" && failOnce) {
      failOnce = false;
      throw new Error("Transient node timeout after journal begin");
    }
    return node.rpc(method, params);
  };
  await assert.rejects(
    service.registerRefundReceipt(invoice.id, body, key),
    code("CHAIN_UNAVAILABLE"),
  );
  assert.equal(store.operation(key).state, "retryable");
  await assert.rejects(
    service.registerRefundReceipt(
      invoice.id,
      { ...body, txid: "f".repeat(64) },
      key,
    ),
    code("IDEMPOTENCY_CONFLICT"),
  );
  const transaction = node.txs.get(txid);
  node.txs.delete(txid);
  await assert.rejects(
    service.registerRefundReceipt(invoice.id, body, key),
    code("REFUND_TRANSACTION_NOT_FOUND"),
  );
  node.txs.set(txid, transaction);
  node.mempool.delete(txid);
  await assert.rejects(
    service.registerRefundReceipt(invoice.id, body, key),
    code("REFUND_NOT_BROADCAST"),
  );
  node.mempool.add(txid);
  const result = await service.registerRefundReceipt(invoice.id, body, key);
  assert.equal(result.invoice.refundTxid, txid);
  assert.equal(store.operation(key).state, "complete");
  assert.deepEqual(
    await service.registerRefundReceipt(invoice.id, body, key),
    result,
  );
});

test("A receipt journal left pending by a crash resumes proof verification after restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-receipt-restart-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "merchant.sqlite");
  const node = new MerchantNode();
  let store = new MerchantStore(path);
  let service = new MerchantService({
    store,
    identity,
    rpc: node.rpc,
    assertNetwork: node.assertNetwork,
    now: () => node.now,
  });
  const { invoice } = await service.createInvoice(input, randomUUID());
  node.receive(invoice.address, "0.25", 1);
  const { request } = await service.createRefundRequest(
    invoice.id,
    { address: destination },
    randomUUID(),
  );
  const txid = node.outgoing(destination, "0.25");
  const body = { requestId: request.id, txid };
  const key = randomUUID();
  const fingerprint = createHash("sha256")
    .update(
      canonical({
        action: "refund-receipt",
        payload: body,
        invoiceId: invoice.id,
      }),
    )
    .digest("hex");
  store.beginOperation(key, fingerprint, invoice.id);
  store.close();
  store = new MerchantStore(path);
  t.after(() => store.close());
  service = new MerchantService({
    store,
    identity,
    rpc: node.rpc,
    assertNetwork: node.assertNetwork,
    now: () => node.now,
  });
  const result = await service.registerRefundReceipt(invoice.id, body, key);
  assert.equal(result.invoice.refundTxid, txid);
  assert.equal(store.operation(key).state, "complete");
  assert.ok(
    node.calls.every(
      (call) => !/send|sign|walletprocess|dump|export/i.test(call.method),
    ),
  );
});

test("Dropped registered refunds require review and recover only when the same transaction returns or confirms", async (t) => {
  const { service, node } = setup(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  node.receive(invoice.address, "0.25", 1);
  const { request } = await service.createRefundRequest(
    invoice.id,
    { address: destination },
    randomUUID(),
  );
  const txid = node.outgoing(destination, "0.25");
  await service.registerRefundReceipt(
    invoice.id,
    { requestId: request.id, txid },
    randomUUID(),
  );
  node.mempool.delete(txid);
  let view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.refundTxid, txid);
  assert.equal(view.refundRequestStatus, "review");
  assert.equal(view.requiresReview, true);
  assert.equal(view.canRequestRefund, false);
  node.mempool.add(txid);
  view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.refundRequestStatus, "broadcast");
  assert.equal(view.requiresReview, false);
  node.mempool.delete(txid);
  node.txs.get(txid).confirmations = 1;
  view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.status, "refunded");
  assert.equal(view.refundRequestStatus, "confirmed");
  assert.equal(view.requiresReview, false);
});

test("Merchant ledger and immutable refund request survive restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-merchant-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "merchant.sqlite");
  const node = new MerchantNode();
  let store = new MerchantStore(path);
  let service = new MerchantService({
    store,
    rpc: node.rpc,
    assertNetwork: node.assertNetwork,
    identity,
    now: () => node.now,
  });
  const createKey = randomUUID();
  const created = await service.createInvoice(input, createKey);
  node.receive(created.invoice.address, "0.25", 1);
  const refundKey = randomUUID();
  const refund = await service.createRefundRequest(
    created.invoice.id,
    { address: destination },
    refundKey,
  );
  store.close();
  store = new MerchantStore(path);
  t.after(() => store.close());
  service = new MerchantService({
    store,
    rpc: node.rpc,
    assertNetwork: node.assertNetwork,
    identity,
    now: () => node.now,
  });
  assert.deepEqual(await service.createInvoice(input, createKey), created);
  assert.deepEqual(
    await service.createRefundRequest(
      created.invoice.id,
      { address: destination },
      refundKey,
    ),
    refund,
  );
  assert.equal(
    (await service.refundRequest(created.invoice.id)).request.id,
    refund.request.id,
  );
});

test("Network guards disable wallet reads and mining; invoice mining passes known pending txids", async (t) => {
  const { service, node } = setup(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  const txid = node.receive(invoice.address, "0.25");
  await service.mine({ blocks: 1, invoiceId: invoice.id });
  assert.deepEqual(node.mineCalls[0], { blocks: 1, pendingTxids: [txid] });
  await assert.rejects(service.mine({ blocks: 11 }), code("INVALID_BLOCKS"));
  node.wrongChain = true;
  await assert.rejects(service.getInvoice(invoice.id), code("WRONG_NETWORK"));
  await assert.rejects(service.mine({ blocks: 1 }), code("WRONG_NETWORK"));
  assert.equal((await service.status()).connected, false);
  node.wrongChain = false;
  node.offline = true;
  const status = await service.status();
  assert.equal(status.connected, false);
  assert.doesNotMatch(JSON.stringify(status), /Sensitive/);
  assert.equal(status.capabilities.serverCanSign, false);
  assert.ok(!Object.hasOwn(status.balances, "payer"));
});

test("Merchant HTTP has no spending routes and protects mutations, checkout QR and static files", async (t) => {
  const { service, node } = setup(t);
  const directory = await mkdtemp(join(tmpdir(), "atlas-merchant-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = join(directory, "dist");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "<html>Atlas devnet</html>");
  await writeFile(join(directory, "secret"), "no");
  await symlink(join(directory, "secret"), join(dist, "escape.txt"));
  let encoded;
  const server = createMerchantHttpServer({
    service,
    staticDir: dist,
    qrEncoder: (uri) => {
      encoded = uri;
      return "<svg />";
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/api/invoices", input, { Origin: "http://127.0.0.1:4174" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/invoices", input, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
  const spoof = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: "/api/invoices",
        method: "POST",
        headers: { Host: "evil.example", "Content-Type": "application/json" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(spoof, 403);
  const created = await post("/api/invoices", input, { Origin: base });
  assert.equal(created.status, 201);
  const { invoice } = await created.json();
  assert.equal((await post(`/api/invoices/${invoice.id}/pay`, {})).status, 404);
  assert.equal(
    (await post(`/api/invoices/${invoice.id}/refund`, {})).status,
    404,
  );
  const request = await fetch(`${base}/api/invoices/${invoice.id}/request`);
  assert.equal((await request.json()).id, invoice.id);
  assert.equal(
    (await fetch(`${base}/api/invoices/${invoice.id}/qr`)).status,
    200,
  );
  assert.equal(encoded, invoice.checkoutUrl);
  assert.ok(encoded.includes("/pay/"));
  assert.equal((await fetch(`${base}/pay/${invoice.id}`)).status, 200);
  assert.equal((await fetch(`${base}/escape.txt`)).status, 400);
  assert.equal(created.headers.get("access-control-allow-origin"), null);
  assert.equal(
    node.calls.filter((call) => /send|sign/.test(call.method)).length,
    0,
  );
});

test("LAVE currency follows immutable network identity and a legacy ledger cannot be reopened as LAVE", async (t) => {
  const { service: atlas, store, node } = setup(t);
  const key = randomUUID();
  const historical = await atlas.createInvoice(input, key);
  const originalRequest = await atlas.paymentRequest(historical.invoice.id);
  assert.equal(historical.invoice.currency, "DASH");
  assert.match(historical.invoice.paymentUri, /^dash:/);
  assert.equal((await atlas.status()).currency, "DASH");
  const laveIdentity = {
    chain: "devnet-lave-local-v1",
    devnetName: "lave-local-v1",
    genesisHash: "2".repeat(64),
    devnetGenesisHash: "3".repeat(64),
    currency: "LAVE",
  };
  const reopen = new MerchantService({
    rpc: node.rpc,
    assertNetwork: async () => ({ ...laveIdentity, blocks: 123 }),
    identity: laveIdentity,
    store,
    now: () => node.now,
  });
  node.calls.length = 0;
  await assert.rejects(
    reopen.getInvoice(historical.invoice.id),
    code("WRONG_NETWORK"),
  );
  await assert.rejects(reopen.createInvoice(input, key), code("WRONG_NETWORK"));
  assert.equal(node.calls.length, 0);
  assert.deepEqual(
    store.get(historical.invoice.id)._paymentRequest,
    originalRequest,
  );

  const laveStore = new MerchantStore(":memory:");
  t.after(() => laveStore.close());
  const lave = new MerchantService({
    rpc: node.rpc,
    assertNetwork: async () => ({ ...laveIdentity, blocks: 123 }),
    identity: laveIdentity,
    store: laveStore,
    now: () => node.now,
  });
  const fresh = await lave.createInvoice(input, randomUUID());
  assert.equal(fresh.invoice.currency, "LAVE");
  assert.match(fresh.invoice.paymentUri, /^lave:/);
  const status = await lave.status();
  assert.equal(status.currency, "LAVE");
  assert.equal(status.profile, "lave");
  const request = await lave.paymentRequest(fresh.invoice.id);
  assert.equal(request.network.currency, "LAVE");
  assert.equal(request.requestHash, requestDigest(request));
});
