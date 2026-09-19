import { randomUUID, createHash } from "node:crypto";
import { AppError, RpcError, publicError } from "./errors.mjs";
import { parseAmount, formatAmount, rpcAmount } from "./money.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TXID = /^[0-9a-f]{64}$/;
const OMIT = ["localPayTxid", "refundAmountSats"];

function canonical(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export function invoiceView(invoice) {
  return Object.fromEntries(
    Object.entries(invoice).filter(([key]) => !OMIT.includes(key)),
  );
}

export function invoiceStatus(
  {
    amountSats,
    receivedSats,
    confirmedSats,
    expiresAt,
    refundTxid,
    refundConfirmed = false,
  },
  now = Date.now(),
) {
  if (refundTxid) return refundConfirmed ? "refunded" : "refund_pending";
  if (confirmedSats >= BigInt(amountSats)) return "paid";
  if (receivedSats >= BigInt(amountSats)) return "detected";
  if (receivedSats > 0n) return "partial";
  return new Date(expiresAt).getTime() <= now ? "expired" : "pending";
}

function validateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("INVALID_INPUT", "A JSON object is required.");
  const allowed = ["amount", "description", "merchantName", "expiresInMinutes"];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new AppError("INVALID_INPUT", "Unknown invoice field.");
  let amountSats;
  try {
    amountSats = parseAmount(body.amount);
  } catch (error) {
    throw new AppError("INVALID_AMOUNT", error.message);
  }
  if (
    typeof body.description !== "string" ||
    body.description.trim().length < 1 ||
    body.description.length > 280
  )
    throw new AppError(
      "INVALID_INPUT",
      "Description must contain 1–280 characters.",
    );
  if (
    typeof body.merchantName !== "string" ||
    body.merchantName.trim().length < 1 ||
    body.merchantName.length > 80
  )
    throw new AppError(
      "INVALID_INPUT",
      "Merchant name must contain 1–80 characters.",
    );
  if (
    !Number.isInteger(body.expiresInMinutes) ||
    body.expiresInMinutes < 1 ||
    body.expiresInMinutes > 10_080
  )
    throw new AppError(
      "INVALID_INPUT",
      "Expiry must be an integer between 1 and 10080 minutes.",
    );
  return {
    ...body,
    amountSats: amountSats.toString(),
    amount: formatAmount(amountSats),
    description: body.description.trim(),
    merchantName: body.merchantName.trim(),
  };
}

export class PaymentService {
  constructor({ rpc, store, now = () => Date.now() }) {
    this.rpc = rpc;
    this.store = store;
    this.now = now;
    this.queue = Promise.resolve();
  }
  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  async assertRegtest() {
    try {
      const chain = await this.rpc.call("getblockchaininfo");
      if (chain.chain !== "regtest")
        throw new AppError(
          "WRONG_NETWORK",
          "Payments are disabled: this server only supports the isolated Dash regtest chain.",
          503,
        );
      const network = await this.rpc.call("getnetworkinfo");
      if (network.networkactive !== false || network.connections !== 0)
        throw new AppError(
          "NETWORK_NOT_ISOLATED",
          "Payments are disabled: the local regtest node must have networking disabled and zero peers.",
          503,
        );
      return chain;
    } catch (error) {
      throw publicError(error);
    }
  }

  async status() {
    const base = {
      network: "regtest",
      connected: false,
      blockHeight: null,
      currency: "DASH",
      balances: { merchant: "0", payer: "0" },
      capabilities: { instantSend: false, chainLocks: false },
    };
    try {
      const chain = await this.assertRegtest();
      const [merchant, payer] = await Promise.all(
        ["merchant", "payer"].map((wallet) =>
          this.rpc.call("getbalance", ["*", 1, false, false], wallet),
        ),
      );
      return {
        ...base,
        connected: true,
        blockHeight: chain.blocks,
        balances: {
          merchant: formatAmount(rpcAmount(merchant)),
          payer: formatAmount(rpcAmount(payer)),
        },
      };
    } catch (error) {
      return { ...base, error: publicError(error).message };
    }
  }

  required(id) {
    const invoice = this.store.get(id);
    if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.", 404);
    return invoice;
  }

  async refresh(id) {
    const original = this.required(id);
    // Dash-specific parameter order: minconf, addlocked, include_empty, include_watchonly, address_filter.
    // InstantSend locks are deliberately excluded; confirmations below come from the actual chain.
    const rows = await this.rpc.call(
      "listreceivedbyaddress",
      [0, false, true, false, original.address],
      "merchant",
    );
    const txids = [
      ...new Set(
        rows
          .filter((row) => row.address === original.address)
          .flatMap((row) => row.txids || []),
      ),
    ];
    let receivedSats = 0n;
    let confirmedSats = 0n;
    let latestTxid = null;
    for (const txid of txids) {
      const tx = await this.rpc.call("gettransaction", [txid], "merchant");
      if (
        tx.confirmations < 0 ||
        tx.abandoned ||
        tx.details?.some((detail) => detail.abandoned)
      )
        continue;
      let amount = 0n;
      for (const detail of tx.details || []) {
        if (
          detail.address === original.address &&
          detail.category === "receive"
        )
          amount += rpcAmount(detail.amount);
      }
      if (amount > 0n) {
        receivedSats += amount;
        if (tx.confirmations >= 1) confirmedSats += amount;
        latestTxid = txid;
      }
    }
    const invoice = this.required(id);
    let refundConfirmed = false;
    let refundNeedsReview = false;
    if (invoice.refundTxid) {
      const tx = await this.rpc.call(
        "gettransaction",
        [invoice.refundTxid],
        "merchant",
      );
      refundConfirmed = tx.confirmations >= 1;
      refundNeedsReview =
        tx.confirmations < 0 ||
        Boolean(tx.abandoned) ||
        Boolean(tx.details?.some((detail) => detail.abandoned));
    }
    const refundSats = BigInt(invoice.refundAmountSats || "0");
    const additionalSats =
      invoice.refundTxid && receivedSats > refundSats
        ? receivedSats - refundSats
        : 0n;
    Object.assign(invoice, {
      receivedAmount: formatAmount(receivedSats),
      confirmedAmount: formatAmount(confirmedSats),
      overpaid: receivedSats > BigInt(invoice.amountSats),
      paymentTxid: latestTxid || invoice.localPayTxid || null,
      status: invoiceStatus(
        { ...invoice, receivedSats, confirmedSats, refundConfirmed },
        this.now(),
      ),
      refundAmount: formatAmount(refundSats),
      additionalReceivedAfterRefund: formatAmount(additionalSats),
      requiresReview: refundNeedsReview || additionalSats > 0n,
      reviewReason: refundNeedsReview
        ? "The refund transaction is conflicted or abandoned. Inspect the local wallets; automatic resend is blocked."
        : additionalSats > 0n
          ? "Additional test coins arrived after the refund was submitted. These funds were not included in the original refund; inspect the local wallets."
          : null,
    });
    this.store.put(invoice);
    return invoice;
  }

  getInvoice(id) {
    return this.exclusive(async () => {
      this.required(id);
      await this.assertRegtest();
      return { invoice: invoiceView(await this.refresh(id)) };
    });
  }
  listInvoices() {
    return this.exclusive(async () => {
      await this.assertRegtest();
      const invoices = [];
      for (const invoice of this.store.all())
        invoices.push(invoiceView(await this.refresh(invoice.id)));
      return { invoices };
    });
  }

  operation({ key, action, payload, invoiceId = null }, callback) {
    return this.exclusive(async () => {
      if (typeof key !== "string" || !UUID.test(key))
        throw new AppError(
          "IDEMPOTENCY_KEY_REQUIRED",
          "Provide a UUID in the Idempotency-Key header.",
        );
      key = key.toLowerCase();
      const fingerprint = createHash("sha256")
        .update(canonical({ action, invoiceId, payload }))
        .digest("hex");
      const previous = this.store.operation(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key belongs to a different request.",
            409,
          );
        if (previous.state === "complete") return previous.response;
        if (previous.state === "failed")
          throw new AppError(
            previous.error.code,
            previous.error.message,
            previous.error.status,
          );
        throw new AppError(
          "OPERATION_UNCERTAIN",
          "The previous operation may have reached the node. Automatic retry is blocked to prevent a duplicate payment. Inspect the local wallets before taking further action.",
          409,
        );
      }
      if (invoiceId) {
        this.required(invoiceId);
        if (this.store.uncertainFor(invoiceId))
          throw new AppError(
            "OPERATION_UNCERTAIN",
            "An earlier operation for this invoice has an uncertain outcome. Further payments and refunds are blocked for wallet inspection.",
            409,
          );
      }
      await this.assertRegtest();
      this.store.beginOperation(key, fingerprint, invoiceId);
      let dispatched = false;
      const control = {
        dispatch: () => {
          dispatched = true;
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
        if (dispatched && !(error instanceof RpcError && error.definitive)) {
          this.store.setOperation(key, "uncertain");
          throw new AppError(
            "OPERATION_UNCERTAIN",
            "The node did not provide a reliable result. This operation will not be automatically retried, to prevent duplicate transactions. Inspect the local wallets.",
            409,
          );
        }
        const safe = publicError(error);
        this.store.setOperation(key, "failed", null, {
          code: safe.code,
          message: safe.message,
          status: safe.status,
        });
        throw safe;
      }
    });
  }

  createInvoice(body, key) {
    const input = validateInput(body);
    return this.operation(
      { key, action: "create", payload: body },
      async (control) => {
        const id = randomUUID();
        control.dispatch();
        const address = await this.rpc.call(
          "getnewaddress",
          [`atlas-invoice:${id}`],
          "merchant",
        );
        if (
          typeof address !== "string" ||
          !/^[A-Za-z0-9]{20,90}$/.test(address)
        )
          throw new Error("Invalid node address");
        const createdAt = new Date(this.now()).toISOString();
        const expiresAt = new Date(
          this.now() + input.expiresInMinutes * 60_000,
        ).toISOString();
        const paymentUri = `dash:${address}?${new URLSearchParams({ amount: input.amount, label: input.merchantName, message: input.description })}`;
        const invoice = {
          id,
          amount: input.amount,
          amountSats: input.amountSats,
          description: input.description,
          merchantName: input.merchantName,
          address,
          paymentUri,
          createdAt,
          expiresAt,
          status: "pending",
          receivedAmount: "0",
          confirmedAmount: "0",
          overpaid: false,
          paymentTxid: null,
          refundTxid: null,
          localPayTxid: null,
          refundAmountSats: null,
          refundAmount: "0",
          additionalReceivedAfterRefund: "0",
          requiresReview: false,
          reviewReason: null,
        };
        const response = { invoice: invoiceView(invoice) };
        control.save(invoice, response);
        return response;
      },
    );
  }

  payInvoice(id, key) {
    return this.operation(
      { key, action: "pay", payload: {}, invoiceId: id },
      async (control) => {
        const invoice = await this.refresh(id);
        if (Date.parse(invoice.expiresAt) <= this.now())
          throw new AppError(
            "INVOICE_EXPIRED",
            "This invoice has expired. Create a new invoice for the local demo payment.",
            409,
          );
        if (invoice.refundTxid)
          throw new AppError(
            "INVOICE_REFUNDED",
            "This invoice already has a refund transaction.",
            409,
          );
        const remaining =
          BigInt(invoice.amountSats) - rpcAmount(invoice.receivedAmount);
        if (remaining <= 0n)
          throw new AppError(
            "ALREADY_PAID",
            "The invoice amount has already been received.",
            409,
          );
        if (invoice.localPayTxid)
          throw new AppError(
            "PAYMENT_ALREADY_SUBMITTED",
            "A local payment was already submitted for this invoice. Inspect its transaction before sending again.",
            409,
          );
        // Recheck immediately before any monetary RPC, including after receipt reconciliation.
        await this.assertRegtest();
        control.dispatch();
        const txid = await this.rpc.call(
          "sendtoaddress",
          [invoice.address, formatAmount(remaining), `atlas-pay:${id}`],
          "payer",
        );
        if (!TXID.test(txid)) throw new Error("Invalid transaction result");
        invoice.localPayTxid = txid;
        invoice.paymentTxid = txid;
        const response = { invoice: invoiceView(invoice), txid };
        control.save(invoice, response);
        try {
          response.invoice = invoiceView(await this.refresh(id));
        } catch {
          /* The durable txid is authoritative; GET retries chain reconciliation. */
        }
        return response;
      },
    );
  }

  refundInvoice(id, key) {
    return this.operation(
      { key, action: "refund", payload: {}, invoiceId: id },
      async (control) => {
        const invoice = await this.refresh(id);
        if (invoice.refundTxid)
          throw new AppError(
            "ALREADY_REFUNDED",
            "A refund has already been submitted for this invoice.",
            409,
          );
        const received = rpcAmount(invoice.receivedAmount);
        if (received === 0n)
          throw new AppError(
            "NOT_PAID",
            "There is no received payment to refund.",
            409,
          );
        if (rpcAmount(invoice.confirmedAmount) !== received)
          throw new AppError(
            "PAYMENT_UNCONFIRMED",
            "Mine a block to confirm all received payments before refunding.",
            409,
          );
        const address = await this.rpc.call(
          "getnewaddress",
          [`atlas-refund:${id}`],
          "payer",
        );
        const info = await this.rpc.call("getaddressinfo", [address], "payer");
        if (!info.ismine)
          throw new AppError(
            "INVALID_REFUND_DESTINATION",
            "Refunds must go to the local test payer wallet.",
            409,
          );
        await this.assertRegtest();
        control.dispatch();
        const txid = await this.rpc.call(
          "sendtoaddress",
          [address, formatAmount(received), `atlas-refund:${id}`],
          "merchant",
        );
        if (!TXID.test(txid)) throw new Error("Invalid transaction result");
        invoice.refundTxid = txid;
        invoice.refundAmountSats = received.toString();
        invoice.refundAmount = formatAmount(received);
        invoice.status = "refund_pending";
        const response = { invoice: invoiceView(invoice), txid };
        control.save(invoice, response);
        try {
          response.invoice = invoiceView(await this.refresh(id));
        } catch {
          /* Persisted refund remains pending until its chain receipt can be read. */
        }
        return response;
      },
    );
  }

  mine(body) {
    return this.exclusive(async () => {
      if (
        !body ||
        Object.keys(body).length !== 1 ||
        !Number.isInteger(body.blocks) ||
        body.blocks < 1 ||
        body.blocks > 10
      )
        throw new AppError(
          "INVALID_BLOCKS",
          "Mine between 1 and 10 blocks per request.",
        );
      await this.assertRegtest();
      const address = await this.rpc.call(
        "getnewaddress",
        ["atlas-mining"],
        "payer",
      );
      await this.assertRegtest();
      await this.rpc.call("generatetoaddress", [body.blocks, address]);
      const chain = await this.assertRegtest();
      return { blockHeight: chain.blocks };
    });
  }
}
