import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../server/errors.mjs";
import { parseAmount, rpcAmount, formatAmount } from "../server/money.mjs";
import { requestDigest, canonical } from "../signer/policy.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TXID = /^[0-9a-f]{64}$/;
const RETRYABLE_RECEIPT_ERRORS = new Set([
  "CHAIN_UNAVAILABLE",
  "REFUND_TRANSACTION_NOT_FOUND",
  "REFUND_NOT_BROADCAST",
]);
const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export function merchantError(error) {
  if (error instanceof AppError) return error;
  return new AppError(
    "CHAIN_UNAVAILABLE",
    "The pinned merchant devnet or its limited RPC credentials are unavailable.",
    503,
  );
}
function object(body, fields) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !fields.includes(key))
  )
    throw new AppError(
      "INVALID_INPUT",
      "Request has invalid or unknown fields.",
    );
}
function amount(value) {
  try {
    return parseAmount(value);
  } catch (error) {
    throw new AppError("INVALID_AMOUNT", error.message);
  }
}
function negativeAmount(value) {
  if (typeof value === "number" && Number.isSafeInteger(value))
    value = String(value);
  if (typeof value !== "string" || !value.startsWith("-")) return 0n;
  return rpcAmount(value.slice(1));
}
export function invoiceView(invoice) {
  return {
    ...Object.fromEntries(
      Object.entries(invoice).filter(([key]) => !key.startsWith("_")),
    ),
    currency: invoice._paymentRequest?.network?.currency || "DASH",
  };
}
function paymentState(invoice, received, confirmed, now) {
  if (invoice.refundTxid) return "refund_pending";
  if (confirmed >= BigInt(invoice.amountSats)) return "paid";
  if (received >= BigInt(invoice.amountSats)) return "detected";
  if (received > 0n) return "partial";
  return Date.parse(invoice.expiresAt) <= now ? "expired" : "pending";
}
function makeRequest({
  id,
  address,
  amountSats,
  merchantName,
  description,
  createdAt,
  expiresAt,
  identity,
}) {
  const request = {
    version: 1,
    id,
    merchantName,
    description,
    address,
    amount: formatAmount(amountSats),
    amountSats: amountSats.toString(),
    createdAt,
    expiresAt,
    network: structuredClone(identity),
  };
  request.requestHash = requestDigest(request);
  return request;
}

export class MerchantService {
  constructor({
    rpc,
    assertNetwork,
    identity,
    store,
    now = () => Date.now(),
    mineDevelopment,
  }) {
    this.rpc = rpc;
    this.assertNetwork = assertNetwork;
    this.identity = identity;
    this.store = store;
    this.now = now;
    this.mineDevelopment = mineDevelopment;
    this.queue = Promise.resolve();
  }
  exclusive(fn) {
    const promise = this.queue.then(fn);
    this.queue = promise.catch(() => {});
    return promise;
  }
  async checkNetwork() {
    try {
      const info = await this.assertNetwork();
      if (
        info.chain !== this.identity.chain ||
        info.genesisHash !== this.identity.genesisHash ||
        info.devnetGenesisHash !== this.identity.devnetGenesisHash
      )
        throw new AppError(
          "WRONG_NETWORK",
          "The merchant node does not match the pinned named devnet.",
          503,
        );
      return info;
    } catch (error) {
      throw merchantError(error);
    }
  }
  required(id) {
    const invoice = this.store.get(id);
    if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.", 404);
    if (
      canonical(invoice._paymentRequest?.network) !== canonical(this.identity)
    )
      throw new AppError(
        "WRONG_NETWORK",
        "Stored invoice belongs to a different blockchain. Select its original network profile.",
        409,
      );
    return invoice;
  }
  async status() {
    const result = {
      network: this.identity.chain,
      mode: "devnet",
      connected: false,
      blockHeight: null,
      currency: this.identity.currency || "DASH",
      profile: this.identity.currency === "LAVE" ? "lave" : "atlas",
      devnetName: this.identity.devnetName,
      balances: { merchant: "0" },
      capabilities: {
        instantSend: false,
        chainLocks: false,
        serverCanSign: false,
      },
      wallets: {
        customer: "http://127.0.0.1:4174",
        merchant: "http://127.0.0.1:4175",
      },
    };
    try {
      const info = await this.checkNetwork();
      const balance = await this.rpc("getbalance", ["*", 1, false, false]);
      return {
        ...result,
        connected: true,
        blockHeight: info.blocks,
        balances: { merchant: formatAmount(rpcAmount(balance)) },
      };
    } catch (error) {
      return { ...result, error: merchantError(error).message };
    }
  }

  async refresh(id) {
    const invoice = this.required(id);
    const rows = await this.rpc("listreceivedbyaddress", [
      0,
      false,
      true,
      false,
      invoice.address,
    ]);
    const ids = [
      ...new Set(
        rows
          .filter((row) => row.address === invoice.address)
          .flatMap((row) => row.txids || []),
      ),
    ];
    let received = 0n;
    let confirmed = 0n;
    let latest = null;
    const pendingTxids = [];
    for (const txid of ids) {
      const tx = await this.rpc("gettransaction", [txid]);
      if (
        tx.confirmations < 0 ||
        tx.abandoned ||
        tx.details?.some((detail) => detail.abandoned)
      )
        continue;
      let value = 0n;
      for (const detail of tx.details || [])
        if (detail.address === invoice.address && detail.category === "receive")
          value += rpcAmount(detail.amount);
      if (value > 0n) {
        received += value;
        if (tx.confirmations >= 1) confirmed += value;
        else pendingTxids.push(txid);
        latest = txid;
      }
    }
    let refundConfirmed = false;
    let refundIssue = false;
    if (invoice.refundTxid) {
      try {
        const tx = await this.rpc("gettransaction", [invoice.refundTxid]);
        refundIssue =
          tx.confirmations < 0 ||
          Boolean(tx.abandoned) ||
          Boolean(tx.details?.some((detail) => detail.abandoned));
        refundConfirmed = !refundIssue && tx.confirmations >= 1;
        if (!refundConfirmed && !refundIssue) {
          await this.rpc("getmempoolentry", [invoice.refundTxid]);
          pendingTxids.push(invoice.refundTxid);
        }
      } catch (error) {
        if (error.code === -5 || error.rpcCode === -5) refundIssue = true;
        else throw error;
      }
    }
    const requestExists = Boolean(invoice._refundRequest);
    const requestTotal = BigInt(invoice._refundReceivedSats || "0");
    const refundChanged =
      requestExists && (received !== requestTotal || confirmed !== received);
    const partial = received > 0n && received < BigInt(invoice.amountSats);
    const additional =
      invoice.refundTxid && received > requestTotal
        ? received - requestTotal
        : 0n;
    let reviewReason = null;
    if (refundIssue)
      reviewReason =
        "The refund transaction is missing, conflicted or abandoned. Inspect the merchant wallet; no automatic second refund is allowed.";
    else if (refundChanged)
      reviewReason =
        "The received payment total changed after the refund request. Review the merchant wallet before continuing; the immutable refund request cannot be changed.";
    else if (partial && !invoice.refundTxid)
      reviewReason =
        "Partial payment received. Customer wallet payment is paused for review; confirmed funds can be returned through the merchant wallet.";
    Object.assign(invoice, {
      receivedAmount: formatAmount(received),
      confirmedAmount: formatAmount(confirmed),
      overpaid: received > BigInt(invoice.amountSats),
      paymentTxid: latest,
      status: refundConfirmed
        ? "refunded"
        : paymentState(invoice, received, confirmed, this.now()),
      refundRequestStatus:
        refundIssue || refundChanged
          ? "review"
          : refundConfirmed
            ? "confirmed"
            : invoice.refundTxid
              ? "broadcast"
              : requestExists
                ? "awaiting_approval"
                : "none",
      additionalReceivedAfterRefund: formatAmount(additional),
      requiresReview: Boolean(reviewReason),
      reviewReason,
      paymentRequestAvailable:
        received === 0n &&
        !requestExists &&
        !invoice.refundTxid &&
        Date.parse(invoice.expiresAt) > this.now(),
      canRequestRefund:
        received > 0n &&
        confirmed === received &&
        !requestExists &&
        !invoice.refundTxid,
      _pendingTxids: pendingTxids,
    });
    this.store.put(invoice);
    return invoice;
  }
  listInvoices() {
    return this.exclusive(async () => {
      await this.checkNetwork();
      const invoices = [];
      for (const invoice of this.store.all())
        invoices.push(invoiceView(await this.refresh(invoice.id)));
      return { invoices };
    });
  }
  getInvoice(id) {
    return this.exclusive(async () => {
      this.required(id);
      await this.checkNetwork();
      return { invoice: invoiceView(await this.refresh(id)) };
    });
  }
  paymentRequest(id) {
    return this.exclusive(async () => {
      this.required(id);
      await this.checkNetwork();
      const invoice = await this.refresh(id);
      if (Date.parse(invoice.expiresAt) <= this.now())
        throw new AppError(
          "INVOICE_EXPIRED",
          "The invoice has expired. Create a new invoice.",
          409,
        );
      if (invoice.refundRequestId || invoice.refundTxid)
        throw new AppError(
          "REFUND_IN_PROGRESS",
          "A refund request exists for this invoice.",
          409,
        );
      const received = rpcAmount(invoice.receivedAmount);
      if (received > 0n && received < BigInt(invoice.amountSats))
        throw new AppError(
          "PARTIAL_PAYMENT_REVIEW",
          "The invoice is partly paid. Review it before preparing another payment.",
          409,
        );
      if (received >= BigInt(invoice.amountSats))
        throw new AppError(
          "ALREADY_PAID",
          "The invoice amount has already been received.",
          409,
        );
      return structuredClone(invoice._paymentRequest);
    });
  }

  operation(key, action, payload, invoiceId, callback) {
    return this.exclusive(async () => {
      if (typeof key !== "string" || !UUID.test(key))
        throw new AppError(
          "IDEMPOTENCY_KEY_REQUIRED",
          "Provide a UUID Idempotency-Key header.",
        );
      key = key.toLowerCase();
      const fingerprint = createHash("sha256")
        .update(canonical({ action, payload, invoiceId }))
        .digest("hex");
      const previous = this.store.operation(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This key belongs to a different request.",
            409,
          );
        if (previous.state === "complete") {
          const original = this.required(previous.response.invoice.id);
          return {
            ...previous.response,
            invoice: {
              ...previous.response.invoice,
              currency: original._paymentRequest.network.currency || "DASH",
            },
          };
        }
        // Receipt registration only reads chain proof and atomically records an
        // existing transaction. It can resume safely after a transient error or
        // a crash, with the original payload fingerprint still enforced.
        const canResumeReceipt =
          action === "refund-receipt" &&
          (["pending", "retryable"].includes(previous.state) ||
            (previous.state === "failed" &&
              RETRYABLE_RECEIPT_ERRORS.has(previous.error?.code)));
        if (!canResumeReceipt) {
          if (previous.state === "failed")
            throw new AppError(
              previous.error.code,
              previous.error.message,
              previous.error.status,
            );
          throw new AppError(
            "OPERATION_UNCERTAIN",
            "This operation did not finish reliably. Inspect the merchant ledger before retrying.",
            409,
          );
        }
      }
      if (invoiceId) this.required(invoiceId);
      await this.checkNetwork();
      if (previous) this.store.setOperation(key, "pending");
      else this.store.beginOperation(key, fingerprint, invoiceId);
      let addressRequested = false;
      const control = {
        addressRequested: () => {
          addressRequested = true;
        },
        save: (invoice, response) =>
          this.store.atomic(() => {
            this.store.put(invoice);
            this.store.setOperation(key, "complete", response);
          }),
      };
      try {
        const response = await callback(control);
        this.store.setOperation(key, "complete", response);
        return response;
      } catch (error) {
        if (this.store.operation(key)?.state === "complete")
          return this.store.operation(key).response;
        if (addressRequested) {
          this.store.setOperation(key, "uncertain");
          throw new AppError(
            "OPERATION_UNCERTAIN",
            "Address creation may have reached the merchant node. The same invoice will not be created again automatically.",
            409,
          );
        }
        const safe = merchantError(error);
        const state =
          action === "refund-receipt" && RETRYABLE_RECEIPT_ERRORS.has(safe.code)
            ? "retryable"
            : "failed";
        this.store.setOperation(key, state, null, {
          code: safe.code,
          message: safe.message,
          status: safe.status,
        });
        throw safe;
      }
    });
  }

  createInvoice(body, key) {
    object(body, ["amount", "description", "merchantName", "expiresInMinutes"]);
    const sats = amount(body.amount);
    if (
      typeof body.description !== "string" ||
      !body.description.trim() ||
      body.description.length > 280 ||
      typeof body.merchantName !== "string" ||
      !body.merchantName.trim() ||
      body.merchantName.length > 80 ||
      CONTROL.test(body.description + body.merchantName)
    )
      throw new AppError(
        "INVALID_INPUT",
        "Provide a safe description (1–280 characters) and merchant name (1–80 characters).",
      );
    if (
      !Number.isInteger(body.expiresInMinutes) ||
      body.expiresInMinutes < 1 ||
      body.expiresInMinutes > 10080
    )
      throw new AppError("INVALID_INPUT", "Expiry must be 1–10080 minutes.");
    return this.operation(key, "create", body, null, async (control) => {
      const id = randomUUID();
      control.addressRequested();
      const address = await this.rpc("getnewaddress", [
        `lavepay-devnet-invoice:${id}`,
      ]);
      if (typeof address !== "string" || !/^[A-Za-z0-9]{20,90}$/.test(address))
        throw new Error("Invalid node address");
      const createdAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(
        this.now() + body.expiresInMinutes * 60_000,
      ).toISOString();
      const merchantName = body.merchantName.trim();
      const description = body.description.trim();
      const request = makeRequest({
        id,
        address,
        amountSats: sats,
        merchantName,
        description,
        createdAt,
        expiresAt,
        identity: this.identity,
      });
      const invoice = {
        id,
        amount: formatAmount(sats),
        amountSats: sats.toString(),
        merchantName,
        description,
        address,
        createdAt,
        expiresAt,
        paymentUri: `${this.identity.currency === "LAVE" ? "lave" : "dash"}:${address}?${new URLSearchParams({ amount: formatAmount(sats), label: merchantName, message: description })}`,
        checkoutUrl: `http://127.0.0.1:4173/pay/${id}`,
        status: "pending",
        receivedAmount: "0",
        confirmedAmount: "0",
        overpaid: false,
        paymentTxid: null,
        refundTxid: null,
        refundRequestId: null,
        refundAddress: null,
        requestedRefundAmount: "0",
        refundRequestStatus: "none",
        refundAmount: "0",
        additionalReceivedAfterRefund: "0",
        requiresReview: false,
        reviewReason: null,
        paymentRequestAvailable: true,
        canRequestRefund: false,
        _paymentRequest: request,
        _refundRequest: null,
        _refundReceivedSats: null,
        _pendingTxids: [],
      };
      const result = { invoice: invoiceView(invoice) };
      control.save(invoice, result);
      return result;
    });
  }

  createRefundRequest(id, body, key) {
    object(body, ["address", "amount"]);
    if (
      typeof body.address !== "string" ||
      !/^[A-Za-z0-9]{20,90}$/.test(body.address)
    )
      throw new AppError(
        "INVALID_REFUND_ADDRESS",
        "An explicit valid devnet destination address is required.",
      );
    if (body.amount !== undefined) amount(body.amount);
    return this.operation(key, "refund-request", body, id, async (control) => {
      const invoice = await this.refresh(id);
      if (invoice._refundRequest)
        throw new AppError(
          "REFUND_REQUEST_EXISTS",
          "This invoice already has an immutable refund request.",
          409,
        );
      const received = rpcAmount(invoice.receivedAmount);
      const confirmed = rpcAmount(invoice.confirmedAmount);
      if (received === 0n)
        throw new AppError(
          "NOT_PAID",
          "No received payment can be refunded.",
          409,
        );
      if (confirmed !== received)
        throw new AppError(
          "PAYMENT_UNCONFIRMED",
          "Confirm all received payments before requesting a refund.",
          409,
        );
      if (body.amount !== undefined && amount(body.amount) !== received)
        throw new AppError(
          "FULL_REFUND_REQUIRED",
          "This version supports refunding the entire confirmed received amount only.",
          409,
        );
      const valid = await this.rpc("validateaddress", [body.address]);
      if (!valid.isvalid || !valid.scriptPubKey)
        throw new AppError(
          "INVALID_REFUND_ADDRESS",
          "The refund address is invalid for this devnet.",
        );
      const owner = await this.rpc("getaddressinfo", [body.address]);
      if (owner.ismine)
        throw new AppError(
          "INVALID_REFUND_ADDRESS",
          "The refund destination must be outside the merchant wallet.",
        );
      const requestId = randomUUID();
      const createdAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(this.now() + 60 * 60_000).toISOString();
      const request = makeRequest({
        id: requestId,
        address: body.address,
        amountSats: received,
        merchantName: invoice.merchantName,
        description: `Refund for invoice ${id}`,
        createdAt,
        expiresAt,
        identity: this.identity,
      });
      Object.assign(invoice, {
        refundRequestId: requestId,
        refundAddress: body.address,
        requestedRefundAmount: formatAmount(received),
        refundRequestStatus: "awaiting_approval",
        canRequestRefund: false,
        paymentRequestAvailable: false,
        _refundRequest: request,
        _refundReceivedSats: received.toString(),
        _refundScript: valid.scriptPubKey,
      });
      const result = {
        invoice: invoiceView(invoice),
        request: structuredClone(request),
      };
      control.save(invoice, result);
      return result;
    });
  }
  refundRequest(id) {
    return this.exclusive(async () => {
      this.required(id);
      await this.checkNetwork();
      const invoice = await this.refresh(id);
      if (!invoice._refundRequest)
        throw new AppError(
          "NOT_FOUND",
          "No refund request exists for this invoice.",
          404,
        );
      if (invoice.refundTxid)
        throw new AppError(
          "ALREADY_REFUNDED",
          "A refund transaction has already been registered.",
          409,
        );
      if (Date.parse(invoice._refundRequest.expiresAt) <= this.now())
        throw new AppError(
          "REFUND_REQUEST_EXPIRED",
          "The refund request expired. Inspect the merchant wallet before continuing.",
          409,
        );
      if (
        rpcAmount(invoice.receivedAmount).toString() !==
          invoice._refundReceivedSats ||
        invoice.confirmedAmount !== invoice.receivedAmount
      )
        throw new AppError(
          "REFUND_TOTAL_CHANGED",
          "The received total changed or is no longer fully confirmed. Review this immutable refund request.",
          409,
        );
      return {
        invoice: invoiceView(invoice),
        request: structuredClone(invoice._refundRequest),
      };
    });
  }

  registerRefundReceipt(id, body, key) {
    object(body, ["requestId", "txid"]);
    if (
      typeof body.requestId !== "string" ||
      !UUID.test(body.requestId) ||
      typeof body.txid !== "string" ||
      !TXID.test(body.txid)
    )
      throw new AppError(
        "INVALID_RECEIPT",
        "Provide the refund request UUID and transaction ID.",
      );
    return this.operation(key, "refund-receipt", body, id, async (control) => {
      const invoice = await this.refresh(id);
      const request = invoice._refundRequest;
      if (!request || request.id !== body.requestId)
        throw new AppError(
          "REFUND_REQUEST_MISMATCH",
          "Receipt does not belong to this invoice refund request.",
          409,
        );
      if (invoice.refundTxid) {
        if (invoice.refundTxid !== body.txid)
          throw new AppError(
            "REFUND_RECEIPT_CONFLICT",
            "A different refund transaction is already registered.",
            409,
          );
        return { invoice: invoiceView(invoice), txid: body.txid };
      }
      if (body.txid === invoice.paymentTxid)
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "A refund must be a separate outgoing merchant transaction.",
          409,
        );
      if (
        this.store
          .all()
          .some((other) => other.id !== id && other.refundTxid === body.txid)
      )
        throw new AppError(
          "REFUND_RECEIPT_CONFLICT",
          "This transaction is already registered for another invoice.",
          409,
        );
      let tx;
      try {
        tx = await this.rpc("gettransaction", [body.txid, false, true]);
      } catch (error) {
        if (error.code === -5 || error.rpcCode === -5)
          throw new AppError(
            "REFUND_TRANSACTION_NOT_FOUND",
            "The merchant wallet has no such transaction.",
            409,
          );
        throw error;
      }
      if (
        tx.confirmations < 0 ||
        tx.abandoned ||
        tx.details?.some((detail) => detail.abandoned)
      )
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "The refund transaction is conflicted or abandoned.",
          409,
        );
      if (
        !Number.isInteger(tx.time) ||
        tx.time < Math.floor(Date.parse(request.createdAt) / 1000)
      )
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "The outgoing transaction predates this refund request.",
          409,
        );
      if (tx.confirmations === 0) {
        try {
          await this.rpc("getmempoolentry", [body.txid]);
        } catch (error) {
          if (error.code === -5 || error.rpcCode === -5)
            throw new AppError(
              "REFUND_NOT_BROADCAST",
              "The outgoing refund is not confirmed or present in the merchant node mempool.",
              409,
            );
          throw error;
        }
      }
      const expected = BigInt(request.amountSats);
      const sends = (tx.details || []).filter(
        (detail) =>
          detail.category === "send" && detail.address === request.address,
      );
      if (
        sends.length !== 1 ||
        negativeAmount(sends[0].amount) !== expected ||
        negativeAmount(tx.fee) === 0n
      )
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "The merchant wallet did not send the exact requested refund.",
          409,
        );
      const decoded =
        tx.decoded || (await this.rpc("decoderawtransaction", [tx.hex]));
      if (
        decoded.txid !== body.txid ||
        decoded.type !== 0 ||
        decoded.extraPayload
      )
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "Unexpected refund transaction type or identity.",
          409,
        );
      let matches = 0;
      for (const output of decoded.vout) {
        if (output.scriptPubKey.hex === invoice._refundScript) {
          if (rpcAmount(output.value) !== expected)
            throw new AppError(
              "INVALID_REFUND_TRANSACTION",
              "Refund output amount does not match the request.",
              409,
            );
          matches++;
        } else {
          const address = output.scriptPubKey.address;
          if (!address || !(await this.rpc("getaddressinfo", [address])).ismine)
            throw new AppError(
              "INVALID_REFUND_TRANSACTION",
              "Refund contains an unexpected non-merchant output.",
              409,
            );
        }
      }
      if (matches !== 1)
        throw new AppError(
          "INVALID_REFUND_TRANSACTION",
          "Refund destination output is missing or duplicated.",
          409,
        );
      Object.assign(invoice, {
        refundTxid: body.txid,
        refundAmount: request.amount,
        status: tx.confirmations >= 1 ? "refunded" : "refund_pending",
        refundRequestStatus: tx.confirmations >= 1 ? "confirmed" : "broadcast",
        canRequestRefund: false,
        paymentRequestAvailable: false,
      });
      const result = { invoice: invoiceView(invoice), txid: body.txid };
      control.save(invoice, result);
      return result;
    });
  }

  mine(body) {
    return this.exclusive(async () => {
      object(body, ["blocks", "invoiceId"]);
      if (
        !Number.isInteger(body.blocks) ||
        body.blocks < 1 ||
        body.blocks > 10 ||
        (body.invoiceId !== undefined &&
          (typeof body.invoiceId !== "string" || !UUID.test(body.invoiceId)))
      )
        throw new AppError(
          "INVALID_BLOCKS",
          "Mine 1–10 blocks; invoiceId must be a UUID if supplied.",
        );
      if (!this.mineDevelopment)
        throw new AppError(
          "MINING_UNAVAILABLE",
          "Local devnet mining is not configured.",
          503,
        );
      await this.checkNetwork();
      let pendingTxids = [];
      if (body.invoiceId) {
        let invoice = await this.refresh(body.invoiceId);
        const deadline = Date.now() + 2500;
        while (
          invoice.receivedAmount === "0" &&
          !invoice.refundTxid &&
          Date.now() < deadline
        ) {
          await delay(125);
          invoice = await this.refresh(body.invoiceId);
        }
        if (invoice.receivedAmount === "0" && !invoice.refundTxid)
          throw new AppError(
            "PAYMENT_NOT_DETECTED",
            "The merchant has not received the payment transaction yet. Wait for P2P relay before confirming.",
            409,
          );
        pendingTxids = invoice._pendingTxids || [];
      }
      return this.mineDevelopment({ blocks: body.blocks, pendingTxids });
    });
  }
}
