import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { SignerStore } from "../signer/store.mjs";
import { requestDigest, SignerError } from "../signer/policy.mjs";
import { WalletService } from "../wallet/service.mjs";
import { createWalletServer } from "../wallet/http.mjs";

const INVOICE = "11111111-1111-4111-8111-111111111111";
const REFUND = "22222222-2222-4222-8222-222222222222";
const identity = {
  chain: "devnet-atlas-local-v1",
  devnetName: "atlas-local-v1",
  genesisHash: "0".repeat(64),
  devnetGenesisHash: "1".repeat(64),
};
function request(id = INVOICE) {
  const item = {
    version: 1,
    id,
    merchantName: "Merchant",
    description: "Item",
    address: "y" + "a".repeat(33),
    network: identity,
    amount: "0.25",
    amountSats: "25000000",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  return { ...item, requestHash: requestDigest(item) };
}
function fixture(role = "customer") {
  const store = new SignerStore(":memory:");
  const calls = { prepare: 0, sign: 0, source: 0, receipt: 0 };
  const original = request(role === "customer" ? INVOICE : REFUND);
  let unavailable = false,
    receiptDown = false,
    lost = false;
  const signer = {
    role,
    identity,
    required(id) {
      const found = store.get(id);
      if (!found) throw new SignerError("NOT_FOUND", "Missing");
      return found;
    },
    async prepare(item) {
      calls.prepare++;
      if (!store.get(item.id))
        store.create({
          id: item.id,
          request: item,
          state: "prepared",
          amount: "0.25",
          fingerprint: "a".repeat(64),
          txid: null,
        });
    },
    async status(id) {
      const row = this.required(id);
      return {
        id,
        state: row.state,
        fingerprint: row.fingerprint,
        amount: row.amount,
        txid: row.txid,
        chainAvailable: true,
        confirmationState: row.txid ? "pending" : "unknown",
      };
    },
    async approve(id, decide) {
      const row = this.required(id);
      if (row.state === "broadcast") return;
      if (!(await decide(await this.status(id)))) throw new Error("Declined");
      calls.sign++;
      row.rawHex = "signedbytes";
      row.txid = "f".repeat(64);
      row.state = lost ? "broadcast_unknown" : "broadcast";
      store.put(row);
      if (lost) throw new SignerError("BROADCAST_UNCERTAIN", "Lost response");
    },
    async cancel(id) {
      const row = this.required(id);
      row.state = "cancelled";
      store.put(row);
    },
  };
  const merchant = async (_id, action) => {
    if (action === "refund-receipt") {
      calls.receipt++;
      if (receiptDown) throw new Error("offline");
      return { invoice: { id: INVOICE, refundTxid: "f".repeat(64) } };
    }
    calls.source++;
    if (unavailable)
      throw new SignerError("PARTIAL_PAYMENT_REVIEW", "Invoice changed");
    return action === "request"
      ? structuredClone(original)
      : { invoice: { id: INVOICE }, request: structuredClone(original) };
  };
  return {
    service: new WalletService({ signer, store, role, merchant }),
    signer,
    store,
    calls,
    unavailable(value) {
      unavailable = value;
    },
    receiptDown(value) {
      receiptDown = value;
    },
    lost(value) {
      lost = value;
    },
  };
}

test("wallet imports are role-limited and repeated preparation shares one immutable draft", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.service.prepare({ invoiceId: INVOICE, kind: "refund" }),
      { code: "WRONG_ROLE" },
    );
    const results = await Promise.all([
      f.service.prepare({ invoiceId: INVOICE, kind: "payment" }),
      f.service.prepare({ invoiceId: INVOICE, kind: "payment" }),
    ]);
    assert.equal(results[0].review.id, INVOICE);
    assert.equal(results[1].review.fingerprint, "a".repeat(64));
    await f.service.prepare({ invoiceId: INVOICE, kind: "payment" });
    assert.equal(f.calls.prepare, 1);
    assert.equal(f.calls.source, 1);
  } finally {
    f.store.close();
  }
});

test("approval requires exact reviewed fingerprint and refreshes merchant source before signing", async () => {
  const f = fixture();
  try {
    await f.service.prepare({ invoiceId: INVOICE, kind: "payment" });
    await assert.rejects(
      f.service.approve({ requestId: INVOICE, fingerprint: "wrong" }),
      { code: "APPROVAL_MISMATCH" },
    );
    f.unavailable(true);
    await assert.rejects(
      f.service.approve({ requestId: INVOICE, fingerprint: "a".repeat(64) }),
      { code: "PARTIAL_PAYMENT_REVIEW" },
    );
    assert.equal(f.calls.sign, 0);
    f.unavailable(false);
    await f.service.approve({
      requestId: INVOICE,
      fingerprint: "a".repeat(64),
    });
    f.unavailable(true);
    await f.service.approve({
      requestId: INVOICE,
      fingerprint: "a".repeat(64),
    });
    assert.equal(f.calls.sign, 1);
  } finally {
    f.store.close();
  }
});

test("lost broadcast remains visible and refund receipt synchronization retries without another signature", async () => {
  const f = fixture("merchant");
  try {
    await f.service.prepare({ invoiceId: INVOICE, kind: "refund" });
    f.lost(true);
    f.receiptDown(true);
    const initial = await f.service.approve({
      requestId: REFUND,
      fingerprint: "a".repeat(64),
    });
    assert.equal(initial.review.state, "broadcast");
    assert.equal(initial.review.receiptPending, true);
    assert.equal(initial.review.txid, "f".repeat(64));
    f.receiptDown(false);
    const replay = await f.service.getRequest(REFUND);
    assert.equal(replay.review.receiptSync, "synced");
    assert.equal(replay.review.receiptPending, false);
    assert.equal(f.calls.sign, 1);
    assert.equal(f.calls.receipt, 2);
  } finally {
    f.store.close();
  }
});

test("HTTP signing requires exact Host, mandatory Origin, role session cookie and CSRF token", async () => {
  const calls = [];
  const service = {
    signer: { identity },
    async status() {
      return { role: "customer", network: identity, chainAvailable: true };
    },
    async approve(body) {
      calls.push(body);
      return { review: { id: body.requestId } };
    },
  };
  const server = createWalletServer({ service, role: "customer" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(origin + "/api/wallet/status");
    const body = await status.json();
    const cookie = status.headers.get("set-cookie").split(";")[0];
    assert.match(cookie, /^atlas_customer_wallet_session=/);
    assert.match(status.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.equal(status.headers.get("x-frame-options"), "DENY");
    assert.equal(status.headers.get("access-control-allow-origin"), null);
    const post = (headers = {}) =>
      fetch(origin + "/api/wallet/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          requestId: INVOICE,
          fingerprint: "a".repeat(64),
        }),
      });
    assert.equal((await post()).status, 403);
    assert.equal(
      (
        await post({
          Origin: "http://evil.example",
          Cookie: cookie,
          "X-CSRF-Token": body.csrfToken,
        })
      ).status,
      403,
    );
    assert.equal((await post({ Origin: origin, Cookie: cookie })).status, 403);
    assert.equal(
      (await post({ Origin: origin, "X-CSRF-Token": body.csrfToken })).status,
      403,
    );
    assert.equal(
      (
        await post({
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": "b".repeat(64),
        })
      ).status,
      403,
    );
    const wrongHostStatus = await new Promise((resolve, reject) => {
      const req = http.request(
        `${origin}/api/wallet/status`,
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await post({
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": body.csrfToken,
        })
      ).status,
      200,
    );
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("wallet balance keeps unconfirmed own change visible and moves it to confirmed without double counting", async () => {
  const f = fixture();
  try {
    let confirmed = "0.12500001";
    let trusted = "19.32498875";
    let external = "0.00000002";
    f.signer.checkNetwork = async () => ({ blocks: 130 });
    f.store.db
      .prepare(
        "INSERT INTO wallet_settings(key,value) VALUES('receiveAddress',?)",
      )
      .run("y" + "a".repeat(33));
    f.signer.rpc = async (role, method, params, wallet) => {
      assert.equal(role, "customer");
      assert.equal(wallet, "customer");
      if (method === "getbalance") {
        assert.deepEqual(params, ["*", 1, false, false]);
        return confirmed;
      }
      if (method === "getaddressinfo")
        return { ismine: true, iswatchonly: false };
      if (method === "listunspent")
        return [{ amount: "0.1", spendable: true, safe: true }];
      assert.equal(method, "getbalances");
      return { mine: { trusted, untrusted_pending: external, immature: "50" } };
    };
    const pending = await f.service.status();
    assert.equal(pending.balance, "0.12500001");
    assert.equal(pending.availableBalance, "0.1");
    assert.equal(pending.lockedBalance, "0.02500001");
    assert.equal(pending.pendingBalance, "19.19998876");
    confirmed = "19.32498877";
    trusted = confirmed;
    external = "0";
    const mined = await f.service.status();
    assert.equal(mined.balance, "19.32498877");
    assert.equal(mined.pendingBalance, "0");
    trusted = "0.1";
    await assert.rejects(f.service.status(), { code: "BALANCE_CHANGED" });
  } finally {
    f.store.close();
  }
});

test("An offline LAVE wallet preserves explicit currency and uses a separate session cookie", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.signer.identity = {
    ...identity,
    chain: "devnet-lave-local-v1",
    devnetName: "lave-local-v1",
    currency: "LAVE",
  };
  f.service.status = async () => {
    throw new Error("Node is offline");
  };
  const server = createWalletServer({ service: f.service, role: "customer" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/wallet/status`,
  );
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.currency, "LAVE");
  assert.equal(status.profile, "lave");
  assert.equal(status.devnetName, "lave-local-v1");
  assert.equal(status.chainAvailable, false);
  assert.equal(status.balance, null);
  assert.match(
    response.headers.get("set-cookie"),
    /^lave_customer_wallet_session=/,
  );
});

test("A copied journal or replaced wallet cannot advertise an unowned receiving address", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const oldAddress = "y" + "a".repeat(33);
  f.store.db
    .prepare(
      "INSERT INTO wallet_settings(key,value) VALUES('receiveAddress',?)",
    )
    .run(oldAddress);
  f.signer.identity = {
    ...identity,
    chain: "devnet-lave-local-v1",
    currency: "LAVE",
  };
  f.signer.checkNetwork = async () => ({ blocks: 130 });
  let owned = false;
  f.signer.rpc = async (_role, method, params) => {
    if (method === "getbalance") return "1";
    if (method === "listunspent")
      return [{ amount: "1", spendable: true, safe: true }];
    if (method === "getbalances")
      return { mine: { trusted: "1", untrusted_pending: "0" } };
    assert.equal(method, "getaddressinfo");
    assert.deepEqual(params, [oldAddress]);
    return { ismine: owned, iswatchonly: false };
  };
  await assert.rejects(f.service.status(), {
    code: "RECEIVE_ADDRESS_MISMATCH",
  });
  owned = true;
  assert.equal((await f.service.status()).receiveAddress, oldAddress);
  owned = false;
  await assert.rejects(f.service.status(), {
    code: "RECEIVE_ADDRESS_MISMATCH",
  });
});
