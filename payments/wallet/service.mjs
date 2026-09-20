import { randomUUID } from "node:crypto";
import {
  requirePolicy,
  SignerError,
  validateRequest,
} from "../signer/policy.mjs";
import { formatAmount, rpcAmount } from "../server/money.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function merchantRequest(
  invoiceId,
  action,
  { body, idempotencyKey } = {},
) {
  requirePolicy(
    UUID.test(invoiceId),
    "INVALID_INPUT",
    "Invoice ID must be a UUID.",
  );
  requirePolicy(
    ["request", "refund-request", "refund-receipt"].includes(action),
    "INVALID_INPUT",
    "Unsupported merchant request.",
  );
  const response = await fetch(
    `http://127.0.0.1:4173/api/invoices/${invoiceId}/${action}`,
    {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: body
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            Origin: "http://127.0.0.1:4173",
          }
        : {},
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const raw = await response.text();
  requirePolicy(
    raw.length <= 131072,
    "MERCHANT_UNAVAILABLE",
    "Merchant response exceeds the supported size.",
  );
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new SignerError(
      "MERCHANT_UNAVAILABLE",
      "Merchant returned an invalid response.",
    );
  }
  if (!response.ok)
    throw new SignerError(
      result.error?.code || "MERCHANT_REJECTED",
      result.error?.message || "The merchant request is no longer available.",
    );
  return result;
}

export class WalletService {
  constructor({ signer, store, role, merchant = merchantRequest }) {
    requirePolicy(
      ["customer", "merchant"].includes(role) && signer.role === role,
      "WRONG_ROLE",
      "Wallet and signer roles must match.",
    );
    Object.assign(this, { signer, store, role, merchant });
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS wallet_imports(invoice_id TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, receipt_key TEXT NOT NULL, receipt_state TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(invoice_id,kind)); CREATE TABLE IF NOT EXISTS wallet_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
    );
    this.preparing = new Map();
  }
  binding(id) {
    return this.store.db
      .prepare("SELECT * FROM wallet_imports WHERE request_id=?")
      .get(id);
  }
  imported(invoiceId, kind) {
    return this.store.db
      .prepare("SELECT * FROM wallet_imports WHERE invoice_id=? AND kind=?")
      .get(invoiceId, kind);
  }
  async source(invoiceId, kind) {
    const result = await this.merchant(
      invoiceId,
      kind === "payment" ? "request" : "refund-request",
    );
    const request = kind === "payment" ? result : result.request;
    if (kind === "payment")
      requirePolicy(
        request?.id === invoiceId,
        "REQUEST_CHANGED",
        "Payment request ID does not match the invoice.",
      );
    else
      requirePolicy(
        result.invoice?.id === invoiceId,
        "REQUEST_CHANGED",
        "Refund belongs to a different invoice.",
      );
    validateRequest(request, this.signer.identity);
    return request;
  }
  async status() {
    const chain = await this.signer.checkNetwork();
    const [balance, balances, spendable] = await Promise.all([
      this.signer.rpc(
        this.role,
        "getbalance",
        ["*", 1, false, false],
        this.role,
      ),
      this.signer.rpc(this.role, "getbalances", [], this.role),
      this.signer.rpc(
        this.role,
        "listunspent",
        [1, 9999999, [], false],
        this.role,
      ),
    ]);
    const confirmed = rpcAmount(balance);
    const available = spendable
      .filter((coin) => coin.spendable === true && coin.safe === true)
      .reduce((sum, coin) => sum + rpcAmount(coin.amount), 0n);
    requirePolicy(
      available <= confirmed,
      "BALANCE_CHANGED",
      "The wallet balance changed during refresh. Refresh again.",
    );
    // Dash's trusted balance includes our own unconfirmed change. Subtract
    // the explicitly confirmed balance before adding external pending funds.
    const trusted = rpcAmount(balances.mine.trusted);
    requirePolicy(
      trusted >= confirmed,
      "BALANCE_CHANGED",
      "The wallet balance changed during refresh. Refresh again.",
    );
    const pending =
      trusted - confirmed + rpcAmount(balances.mine.untrusted_pending);
    if (!this.addressPromise)
      this.addressPromise = (async () => {
        const known = this.store.db
          .prepare(
            "SELECT value FROM wallet_settings WHERE key='receiveAddress'",
          )
          .get();
        if (known) return known.value;
        await this.signer.checkNetwork();
        const address = await this.signer.rpc(
          this.role,
          "getnewaddress",
          ["lavepay-wallet-receive"],
          this.role,
        );
        this.store.db
          .prepare(
            "INSERT OR IGNORE INTO wallet_settings(key,value) VALUES('receiveAddress',?)",
          )
          .run(address);
        return this.store.db
          .prepare(
            "SELECT value FROM wallet_settings WHERE key='receiveAddress'",
          )
          .get().value;
      })().catch((error) => {
        this.addressPromise = null;
        throw error;
      });
    const receiveAddress = await this.addressPromise;
    // A copied journal or a replaced node wallet must never advertise an old
    // address as a receiving address for the currently verified network.
    const addressInfo = await this.signer.rpc(
      this.role,
      "getaddressinfo",
      [receiveAddress],
      this.role,
    );
    requirePolicy(
      addressInfo.ismine === true && !addressInfo.iswatchonly,
      "RECEIVE_ADDRESS_MISMATCH",
      "The saved receiving address does not belong to this network's signing wallet.",
    );
    return {
      role: this.role,
      network: this.signer.identity,
      currency: this.signer.identity.currency || "DASH",
      profile: this.signer.identity.currency === "LAVE" ? "lave" : "atlas",
      devnetName: this.signer.identity.devnetName,
      balance: formatAmount(confirmed),
      availableBalance: formatAmount(available),
      lockedBalance: formatAmount(confirmed - available),
      pendingBalance: formatAmount(pending),
      receiveAddress,
      chainAvailable: true,
      blockHeight: chain.blocks,
    };
  }
  async prepare({ invoiceId, kind }) {
    requirePolicy(
      UUID.test(invoiceId),
      "INVALID_INPUT",
      "Invoice ID must be a UUID.",
    );
    requirePolicy(
      kind === (this.role === "customer" ? "payment" : "refund"),
      "WRONG_ROLE",
      "This wallet cannot prepare that operation.",
    );
    const key = `${invoiceId}:${kind}`;
    if (this.preparing.has(key)) return this.preparing.get(key);
    const operation = this.prepareOnce(invoiceId, kind).finally(() =>
      this.preparing.delete(key),
    );
    this.preparing.set(key, operation);
    return operation;
  }
  async prepareOnce(invoiceId, kind) {
    const imported = this.imported(invoiceId, kind);
    if (imported && this.store.get(imported.request_id))
      return this.getRequest(imported.request_id);
    const request = await this.source(invoiceId, kind);
    if (imported)
      requirePolicy(
        imported.request_id === request.id,
        "REQUEST_CHANGED",
        "The invoice request changed after import.",
      );
    else
      this.store.db
        .prepare(
          "INSERT INTO wallet_imports(invoice_id,kind,request_id,receipt_key) VALUES(?,?,?,?)",
        )
        .run(invoiceId, kind, request.id, randomUUID());
    await this.signer.prepare(request);
    return this.getRequest(request.id);
  }
  async refreshSource(binding, record) {
    const request = await this.source(binding.invoice_id, binding.kind);
    requirePolicy(
      request.id === record.request.id &&
        request.requestHash === record.request.requestHash,
      "REQUEST_CHANGED",
      "Payment or refund details changed after preparation. Nothing was signed.",
    );
  }
  async approve({ requestId, fingerprint }) {
    requirePolicy(
      UUID.test(requestId),
      "INVALID_INPUT",
      "Request ID must be a UUID.",
    );
    const binding = this.binding(requestId);
    requirePolicy(
      binding,
      "NOT_FOUND",
      "This request has not been imported by this wallet.",
    );
    const record = this.signer.required(requestId);
    requirePolicy(
      typeof fingerprint === "string" && fingerprint === record.fingerprint,
      "APPROVAL_MISMATCH",
      "Approval fingerprint does not match the reviewed transaction.",
    );
    // Previously signed bytes may be reconciled even after the invoice becomes paid.
    // A fresh signature always rechecks the current immutable merchant request.
    try {
      await this.signer.approve(requestId, async (review) => {
        requirePolicy(
          review.fingerprint === fingerprint,
          "APPROVAL_MISMATCH",
          "Transaction review changed before approval.",
        );
        if (!record.rawHex) await this.refreshSource(binding, record);
        return true;
      });
    } catch (error) {
      if (error.code !== "BROADCAST_UNCERTAIN") throw error;
      // Preserve a successful send with a lost response as a reviewable result.
      // The journal already contains the exact bytes and transaction ID.
    }
    return this.getRequest(requestId);
  }
  async getRequest(id) {
    requirePolicy(UUID.test(id), "INVALID_INPUT", "Request ID must be a UUID.");
    const binding = this.binding(id);
    requirePolicy(
      binding,
      "NOT_FOUND",
      "This request has not been imported by this wallet.",
    );
    const review = await this.signer.status(id);
    if (
      ["signed", "broadcasting", "broadcast_unknown"].includes(review.state) &&
      ["pending", "confirmed"].includes(review.confirmationState)
    ) {
      try {
        this.store.claim(id, [review.state], "broadcast");
        review.state = "broadcast";
      } catch (error) {
        if (error.code !== "OPERATION_BUSY") throw error;
      }
    }
    let receiptSync =
      binding.kind === "refund" ? binding.receipt_state : "not_applicable";
    let receiptError;
    if (
      binding.kind === "refund" &&
      review.txid &&
      receiptSync !== "synced" &&
      ["pending", "confirmed"].includes(review.confirmationState)
    ) {
      try {
        const result = await this.merchant(
          binding.invoice_id,
          "refund-receipt",
          {
            body: { requestId: id, txid: review.txid },
            idempotencyKey: binding.receipt_key,
          },
        );
        const invoice = result.invoice || result;
        requirePolicy(
          invoice.id === binding.invoice_id &&
            invoice.refundTxid === review.txid,
          "RECEIPT_MISMATCH",
          "Merchant did not acknowledge this refund transaction.",
        );
        this.store.db
          .prepare(
            "UPDATE wallet_imports SET receipt_state='synced' WHERE request_id=?",
          )
          .run(id);
        receiptSync = "synced";
      } catch {
        receiptError =
          "Refund was broadcast; merchant receipt synchronization will retry on refresh.";
      }
    }
    return {
      review: {
        ...review,
        role: this.role,
        invoiceId: binding.invoice_id,
        kind: binding.kind,
        receiptSync,
        receiptPending:
          binding.kind === "refund" &&
          Boolean(review.txid) &&
          receiptSync !== "synced",
        ...(receiptError ? { receiptError } : {}),
      },
    };
  }
  async cancel({ requestId }) {
    requirePolicy(
      UUID.test(requestId) && this.binding(requestId),
      "NOT_FOUND",
      "This request has not been imported by this wallet.",
    );
    await this.signer.cancel(requestId);
    return this.getRequest(requestId);
  }
}
