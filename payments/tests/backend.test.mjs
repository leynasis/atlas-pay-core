import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { parseAmount, formatAmount, rpcAmount } from "../server/money.mjs";
import { parseRpcJson, DashRpc } from "../server/rpc.mjs";
import { RpcError } from "../server/errors.mjs";
import { InvoiceStore } from "../server/store.mjs";
import { PaymentService } from "../server/service.mjs";
import { createHttpServer } from "../server/http.mjs";

const input = {
  amount: "0.25",
  description: "Order #1042",
  merchantName: "Atlas Studio",
  expiresInMinutes: 60,
};

class FakeRpc {
  constructor() {
    this.chain = "regtest";
    this.height = 111;
    this.active = false;
    this.connections = 0;
    this.addresses = new Map();
    this.txs = new Map();
    this.calls = [];
    this.counter = 0;
    this.sendFailure = null;
    this.offline = false;
  }
  receipt(address, amount, confirmations = 0) {
    const txid = (++this.counter).toString(16).padStart(64, "0");
    this.txs.set(txid, {
      txid,
      confirmations,
      details: [{ address, category: "receive", amount }],
    });
    return txid;
  }
  async call(method, params = [], wallet) {
    this.calls.push({ method, params, wallet });
    if (this.offline) throw new RpcError("Offline");
    switch (method) {
      case "getblockchaininfo":
        return { chain: this.chain, blocks: this.height };
      case "getnetworkinfo":
        return { networkactive: this.active, connections: this.connections };
      case "getbalance":
        return "100.00000000";
      case "getnewaddress": {
        const address = `y${String(++this.counter).padStart(33, "1")}`;
        this.addresses.set(address, wallet);
        return address;
      }
      case "getaddressinfo":
        return { ismine: this.addresses.get(params[0]) === wallet };
      case "listreceivedbyaddress": {
        assert.equal(
          params[1],
          false,
          "InstantSend must never count as confirmation",
        );
        const address = params[4];
        return [
          {
            address,
            txids: [...this.txs.values()]
              .filter((tx) =>
                tx.details.some(
                  (detail) =>
                    detail.address === address && detail.category === "receive",
                ),
              )
              .map((tx) => tx.txid),
          },
        ];
      }
      case "gettransaction": {
        const tx = this.txs.get(params[0]);
        if (!tx)
          throw new RpcError("Missing transaction", {
            code: -5,
            definitive: true,
          });
        return tx;
      }
      case "sendtoaddress": {
        assert.equal(
          typeof params[1],
          "string",
          "Spend amount must be exact decimal text",
        );
        if (this.sendFailure === "definite")
          throw new RpcError("Insufficient funds", {
            code: -6,
            definitive: true,
          });
        const txid = this.receipt(params[0], params[1]);
        if (this.sendFailure === "uncertain")
          throw new RpcError("Connection lost after broadcast");
        return txid;
      }
      case "generatetoaddress":
        this.height += params[0];
        for (const tx of this.txs.values())
          if (tx.confirmations >= 0) tx.confirmations += params[0];
        return Array(params[0]).fill("block");
      default:
        throw new Error(`Unexpected RPC ${method}`);
    }
  }
  sends(wallet) {
    return this.calls.filter(
      (call) =>
        call.method === "sendtoaddress" && (!wallet || call.wallet === wallet),
    );
  }
}

function fixture(
  t,
  {
    path = ":memory:",
    rpc = new FakeRpc(),
    startTime = Date.UTC(2026, 8, 20),
  } = {},
) {
  const store = new InvoiceStore(path);
  let now = startTime;
  const service = new PaymentService({ store, rpc, now: () => now });
  t.after(() => store.close());
  return {
    store,
    service,
    rpc,
    advance(ms) {
      now += ms;
    },
  };
}

function hasCode(code) {
  return (error) => error.code === code;
}

test("Money boundaries and arithmetic preserve every satoshi, rejecting float and ambiguous input", () => {
  assert.equal(parseAmount("0.00000001"), 1n);
  assert.equal(parseAmount("21000000"), 2_100_000_000_000_000n);
  assert.equal(parseAmount("0.1") + parseAmount("0.2"), parseAmount("0.3"));
  assert.equal(formatAmount(123456789n), "1.23456789");
  assert.equal(formatAmount(parseAmount("0.25000000")), "0.25");
  for (const value of [
    0.1,
    null,
    "",
    "0",
    "00.1",
    "+1",
    "-1",
    "1e-8",
    " 1",
    "1.",
    ".1",
    "0.000000001",
    "21000000.00000001",
  ])
    assert.throws(() => parseAmount(value), String(value));
  assert.equal(parseAmount("0", { allowZero: true }), 0n);
  const decoded = parseRpcJson(
    '{"result":{"balance":20999999.99999999,"count":123,"text":"a 0.123 \\\"b","array":[0.00000001,0]},"error":null}',
  );
  assert.equal(decoded.result.balance, "20999999.99999999");
  assert.equal(rpcAmount(decoded.result.balance), 2_099_999_999_999_999n);
  assert.equal(rpcAmount(decoded.result.array[0]), 1n);
  assert.equal(decoded.result.count, 123);
  assert.equal(decoded.result.text, 'a 0.123 "b');
});

test("Create idempotency persists one address and rejects payload or action changes", async (t) => {
  const { service, rpc } = fixture(t);
  const key = randomUUID();
  const results = await Promise.all([
    service.createInvoice(input, key),
    service.createInvoice(
      {
        expiresInMinutes: 60,
        merchantName: "Atlas Studio",
        description: "Order #1042",
        amount: "0.25",
      },
      key,
    ),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].invoice.amountSats, "25000000");
  assert.match(results[0].invoice.paymentUri, /^dash:y.+amount=0.25&/);
  assert.equal(
    rpc.calls.filter((call) => call.method === "getnewaddress").length,
    1,
  );
  await assert.rejects(
    service.createInvoice({ ...input, amount: "0.3" }, key),
    hasCode("IDEMPOTENCY_CONFLICT"),
  );
  await assert.rejects(
    service.payInvoice(results[0].invoice.id, key),
    hasCode("IDEMPOTENCY_CONFLICT"),
  );
  await assert.rejects(
    service.createInvoice(input, "not-a-uuid"),
    hasCode("IDEMPOTENCY_KEY_REQUIRED"),
  );
});

test("Partial receipts, exact remaining payment, confirmations, overpayment and reorgs derive from the chain", async (t) => {
  const { service, rpc } = fixture(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  const partial = rpc.receipt(invoice.address, "0.10000001", 1);
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "partial",
  );
  const payKey = randomUUID();
  const [payment, replay] = await Promise.all([
    service.payInvoice(invoice.id, payKey),
    service.payInvoice(invoice.id, payKey),
  ]);
  assert.equal(payment.txid, replay.txid);
  assert.equal(rpc.sends("payer").length, 1);
  assert.equal(rpc.sends("payer")[0].params[1], "0.14999999");
  assert.equal(payment.invoice.status, "detected");
  assert.equal(payment.invoice.receivedAmount, "0.25");
  assert.equal(payment.invoice.confirmedAmount, "0.10000001");
  await service.mine({ blocks: 1 });
  assert.equal((await service.getInvoice(invoice.id)).invoice.status, "paid");
  const extra = rpc.receipt(invoice.address, "0.01", 1);
  assert.equal((await service.getInvoice(invoice.id)).invoice.overpaid, true);
  rpc.txs.get(payment.txid).confirmations = 0;
  rpc.txs.get(extra).confirmations = -1;
  const reorg = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(reorg.status, "detected");
  assert.equal(reorg.overpaid, false);
  rpc.txs.get(payment.txid).details[0].abandoned = true;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.receivedAmount,
    "0.10000001",
  );
  rpc.txs.get(partial).confirmations = -1;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "pending",
  );
  await assert.rejects(
    service.payInvoice(invoice.id, randomUUID()),
    hasCode("PAYMENT_ALREADY_SUBMITTED"),
  );
});

test("Expired demo invoices cannot be paid but external late receipts are still detected and confirmed", async (t) => {
  const { service, rpc, advance } = fixture(t);
  const { invoice } = await service.createInvoice(
    { ...input, expiresInMinutes: 1 },
    randomUUID(),
  );
  advance(60_001);
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "expired",
  );
  await assert.rejects(
    service.payInvoice(invoice.id, randomUUID()),
    hasCode("INVOICE_EXPIRED"),
  );
  rpc.receipt(invoice.address, invoice.amount);
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "detected",
  );
  await service.mine({ blocks: 1 });
  assert.equal((await service.getInvoice(invoice.id)).invoice.status, "paid");
  assert.equal(rpc.sends().length, 0);
});

test("An overdue partial invoice blocks demo top-ups while external late funds still reconcile", async (t) => {
  const { service, rpc, advance } = fixture(t);
  const { invoice } = await service.createInvoice(
    { ...input, expiresInMinutes: 1 },
    randomUUID(),
  );
  rpc.receipt(invoice.address, "0.1", 1);
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "partial",
  );

  advance(60_000);
  // Partial is a receipt state, so it remains truthful after the deadline.
  // The ability to submit another demo payment must use the actual deadline.
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "partial",
  );
  await assert.rejects(
    service.payInvoice(invoice.id, randomUUID()),
    (error) => error.code === "INVOICE_EXPIRED" && error.status === 409,
  );
  assert.equal(rpc.sends().length, 0);

  rpc.receipt(invoice.address, "0.15");
  const late = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(late.status, "detected");
  assert.equal(late.receivedAmount, "0.25");
  assert.equal(late.confirmedAmount, "0.1");
  await service.mine({ blocks: 1 });
  assert.equal((await service.getInvoice(invoice.id)).invoice.status, "paid");
  assert.equal(rpc.sends().length, 0);
});

test("Refund returns all confirmed receipts only to payer, once, and surfaces later money or refund conflicts", async (t) => {
  const { service, rpc } = fixture(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  rpc.receipt(invoice.address, "0.27");
  await assert.rejects(
    service.refundInvoice(invoice.id, randomUUID()),
    hasCode("PAYMENT_UNCONFIRMED"),
  );
  await service.mine({ blocks: 1 });
  const key = randomUUID();
  const refund = await service.refundInvoice(invoice.id, key);
  assert.equal(refund.invoice.status, "refund_pending");
  assert.equal(refund.invoice.refundAmount, "0.27");
  const call = rpc.sends("merchant")[0];
  assert.equal(call.params[1], "0.27");
  assert.equal(rpc.addresses.get(call.params[0]), "payer");
  assert.equal(
    (await service.refundInvoice(invoice.id, key)).txid,
    refund.txid,
  );
  await assert.rejects(
    service.refundInvoice(invoice.id, randomUUID()),
    hasCode("ALREADY_REFUNDED"),
  );
  await service.mine({ blocks: 1 });
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "refunded",
  );
  rpc.txs.get(refund.txid).confirmations = 0;
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "refund_pending",
  );
  rpc.txs.get(refund.txid).confirmations = -1;
  let view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.requiresReview, true);
  assert.match(view.reviewReason, /conflicted/);
  rpc.txs.get(refund.txid).confirmations = 1;
  rpc.receipt(invoice.address, "0.03", 1);
  view = (await service.getInvoice(invoice.id)).invoice;
  assert.equal(view.additionalReceivedAfterRefund, "0.03");
  assert.equal(view.refundAmount, "0.27");
  assert.equal(view.requiresReview, true);
  assert.match(view.reviewReason, /Additional test coins/);
  assert.equal(rpc.sends("merchant").length, 1);
});

test("A spend with lost response blocks all further invoice spends across service restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-pay-uncertain-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "invoices.sqlite");
  const rpc = new FakeRpc();
  const store = new InvoiceStore(path);
  let service = new PaymentService({ store, rpc });
  const { invoice } = await service.createInvoice(input, randomUUID());
  const key = randomUUID();
  rpc.sendFailure = "uncertain";
  await assert.rejects(
    service.payInvoice(invoice.id, key),
    hasCode("OPERATION_UNCERTAIN"),
  );
  assert.equal(rpc.sends().length, 1);
  store.close();
  const reopened = new InvoiceStore(path);
  t.after(() => reopened.close());
  service = new PaymentService({ store: reopened, rpc });
  rpc.sendFailure = null;
  await assert.rejects(
    service.payInvoice(invoice.id, key),
    hasCode("OPERATION_UNCERTAIN"),
  );
  await assert.rejects(
    service.payInvoice(invoice.id, randomUUID()),
    hasCode("OPERATION_UNCERTAIN"),
  );
  await assert.rejects(
    service.refundInvoice(invoice.id, randomUUID()),
    hasCode("OPERATION_UNCERTAIN"),
  );
  assert.equal(
    (await service.getInvoice(invoice.id)).invoice.status,
    "detected",
  );
  assert.equal(rpc.sends().length, 1);
});

test("Completed invoice/payment operations and transaction IDs replay after SQLite restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-pay-restart-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "invoices.sqlite");
  const rpc = new FakeRpc();
  let store = new InvoiceStore(path);
  let service = new PaymentService({ store, rpc });
  const createKey = randomUUID();
  const payKey = randomUUID();
  const created = await service.createInvoice(input, createKey);
  const paid = await service.payInvoice(created.invoice.id, payKey);
  store.close();
  store = new InvoiceStore(path);
  t.after(() => store.close());
  service = new PaymentService({ store, rpc });
  assert.deepEqual(await service.createInvoice(input, createKey), created);
  assert.deepEqual(await service.payInvoice(created.invoice.id, payKey), paid);
  assert.equal((await service.listInvoices()).invoices.length, 1);
  assert.equal(rpc.sends().length, 1);
});

test("Definite insufficient-funds RPC error replays safely without hiding it as uncertainty", async (t) => {
  const { service, rpc } = fixture(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  const key = randomUUID();
  rpc.sendFailure = "definite";
  await assert.rejects(
    service.payInvoice(invoice.id, key),
    hasCode("INSUFFICIENT_FUNDS"),
  );
  await assert.rejects(
    service.payInvoice(invoice.id, key),
    hasCode("INSUFFICIENT_FUNDS"),
  );
  assert.equal(rpc.sends().length, 1);
  rpc.sendFailure = null;
  assert.equal(
    (await service.payInvoice(invoice.id, randomUUID())).invoice.status,
    "detected",
  );
});

test("Wrong-chain, nonisolated and disconnected nodes never receive spend or mine calls", async (t) => {
  const { service, rpc } = fixture(t);
  const { invoice } = await service.createInvoice(input, randomUUID());
  for (const state of [
    { chain: "main", code: "WRONG_NETWORK" },
    { chain: "regtest", active: true, code: "NETWORK_NOT_ISOLATED" },
    { active: false, connections: 1, code: "NETWORK_NOT_ISOLATED" },
    { connections: 0, offline: true, code: "CHAIN_UNAVAILABLE" },
  ]) {
    Object.assign(rpc, state);
    await assert.rejects(
      service.payInvoice(invoice.id, randomUUID()),
      hasCode(state.code),
    );
    await assert.rejects(
      service.refundInvoice(invoice.id, randomUUID()),
      hasCode(state.code),
    );
    await assert.rejects(service.mine({ blocks: 1 }), hasCode(state.code));
    assert.equal((await service.status()).connected, false);
  }
  assert.equal(rpc.sends().length, 0);
  assert.equal(
    rpc.calls.filter((call) => call.method === "generatetoaddress").length,
    0,
  );
  assert.throws(
    () =>
      new DashRpc({ cookiePath: "unused", url: "http://example.com:19898" }),
    /loopback/,
  );
});

test("HTTP enforces Host, Origin, JSON, bounded mining and static containment; checkout routes work", async (t) => {
  const { service, rpc } = fixture(t);
  const dir = await mkdtemp(join(tmpdir(), "atlas-pay-http-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const web = join(dir, "dist");
  await mkdir(web);
  await writeFile(join(web, "index.html"), "<html>Atlas</html>");
  await writeFile(join(dir, "secret"), "DO NOT EXPOSE");
  await symlink(join(dir, "secret"), join(web, "escape.txt"));
  const server = createHttpServer({
    service,
    staticDir: web,
    qrEncoder: (uri) => `<svg><text>${uri}</text></svg>`,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, extra = {}) {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      body: JSON.stringify(body),
    });
  }
  const spoofedHost = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: "/api/invoices",
        method: "POST",
        headers: {
          Host: "attacker.example",
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(input));
  });
  assert.equal(spoofedHost, 403);
  assert.equal(
    (await post("/api/invoices", input, { Origin: "https://attacker.example" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/invoices", input, { Origin: "null" })).status,
    403,
  );
  assert.equal(
    (await post("/api/invoices", input, { Origin: "http://127.0.0.1:5173" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/invoices", input, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/invoices", input, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(
    (await post("/api/invoices", { ...input, amount: 0.25 })).status,
    400,
  );
  const response = await post("/api/invoices", input, { Origin: base });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const { invoice } = await response.json();
  assert.equal(
    (await post(`/api/invoices/${invoice.id}/refund`, { address: "external" }))
      .status,
    400,
  );
  for (const blocks of [0, 11, 1.5, "1"])
    assert.equal((await post("/api/dev/mine", { blocks })).status, 400);
  assert.equal((await fetch(`${base}/checkout/${invoice.id}`)).status, 200);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/escape.txt`)).status, 400);
  const qr = await fetch(`${base}/api/invoices/${invoice.id}/qr`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get("content-type"), /svg/);
  assert.equal(
    (await fetch(`${base}/api/status`)).headers.get("x-content-type-options"),
    "nosniff",
  );
  // Send the raw encoded traversal without fetch's path normalisation.
  const traversal = await new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: "/%2e%2e/secret",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(traversal, 400);
  assert.equal(rpc.sends().length, 0);
});

test("Development origin exception is explicit, fixed and does not become general CORS", async (t) => {
  const { service } = fixture(t);
  assert.throws(
    () =>
      createHttpServer({ service, developmentOrigin: "http://localhost:9999" }),
    /only supported/,
  );
  const server = createHttpServer({
    service,
    developmentOrigin: "http://127.0.0.1:5173",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/invoices`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify(input),
    },
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
