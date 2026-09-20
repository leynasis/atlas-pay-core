import { randomUUID } from "node:crypto";
import { parseAmount, formatAmount } from "../server/money.mjs";
import {
  canonical,
  digest,
  requestDigest,
  validateRequest,
  inspectPsbt,
  transactionTemplate,
  requirePolicy,
  SignerError,
  MAX_FEE_RATE,
} from "./policy.mjs";

export class CustomerSigner {
  constructor({
    rpc,
    assertNode,
    identity,
    store,
    now = () => Date.now(),
    role = "customer",
  }) {
    requirePolicy(
      ["customer", "merchant"].includes(role),
      "WRONG_ROLE",
      "Unsupported signer role.",
    );
    this.role = role;
    this.rpc = rpc;
    this.assertNode = assertNode;
    this.identity = identity;
    this.store = store;
    this.now = now;
  }
  async checkNetwork(node = this.role) {
    requirePolicy(
      node === this.role,
      "WRONG_ROLE",
      "Signer cannot access another role.",
    );
    if (this.assertNode) await this.assertNode(node);
    const chain = await this.rpc(node, "getblockchaininfo");
    const [genesisHash, devnetGenesisHash] = await Promise.all([
      this.rpc(node, "getblockhash", [0]),
      this.rpc(node, "getblockhash", [1]),
    ]);
    requirePolicy(
      chain.chain === this.identity.chain &&
        genesisHash === this.identity.genesisHash &&
        devnetGenesisHash === this.identity.devnetGenesisHash,
      "WRONG_NETWORK",
      "The selected node is not the pinned named devnet.",
    );
    return chain;
  }
  inspect(record) {
    return inspectPsbt({
      request: record.request,
      psbt: record.psbt,
      changeAddress: record.changeAddress,
      identity: this.identity,
      rpc: this.rpc,
      role: this.role,
      now: this.now(),
      expectedTemplateHash: record.templateHash,
    });
  }
  review(record) {
    return {
      id: record.id,
      role: this.role,
      state: record.state,
      merchantName: record.request.merchantName,
      description: record.request.description,
      address: record.request.address,
      network: record.request.network,
      expiresAt: record.request.expiresAt,
      amount: record.amount,
      fee: record.fee,
      total: record.total,
      changeAmount: record.changeAmount,
      changeAddress: record.changeAddress,
      fingerprint: record.fingerprint,
      txid: record.txid || null,
    };
  }
  required(id) {
    const record = this.store.get(id);
    requirePolicy(
      record,
      "NOT_FOUND",
      "No signing draft exists for this request.",
    );
    return record;
  }
  async status(id) {
    const record = this.required(id);
    const result = {
      ...this.review(record),
      chainAvailable: false,
      blockHeight: null,
      confirmationState: "unknown",
      confirmations: null,
      inMempool: null,
    };
    try {
      const chain = await this.checkNetwork();
      result.chainAvailable = true;
      result.blockHeight = chain.blocks;
      if (!record.txid) return result;
      let transaction;
      try {
        transaction = await this.rpc(
          this.role,
          "gettransaction",
          [record.txid],
          this.role,
        );
      } catch (error) {
        if (error.code === -5 || error.rpcCode === -5) return result;
        throw error;
      }
      requirePolicy(
        Number.isInteger(transaction.confirmations),
        "INVALID_TRANSACTION_STATUS",
        "The node returned an invalid transaction status.",
      );
      result.confirmations = transaction.confirmations;
      if (
        transaction.confirmations < 0 ||
        transaction.abandoned ||
        transaction.details?.some((detail) => detail.abandoned)
      ) {
        result.confirmationState = "conflicted";
        result.inMempool = false;
      } else if (transaction.confirmations >= 1) {
        result.confirmationState = "confirmed";
        result.inMempool = false;
      } else {
        try {
          await this.rpc(this.role, "getmempoolentry", [record.txid]);
          result.confirmationState = "pending";
          result.inMempool = true;
        } catch (error) {
          if (error.code !== -5 && error.rpcCode !== -5) throw error;
          result.inMempool = false;
        }
      }
      return result;
    } catch (error) {
      return {
        ...result,
        chainAvailable: false,
        blockHeight: null,
        confirmationState: "unknown",
        confirmations: null,
        inMempool: null,
        error: {
          code:
            error.code === "WRONG_NETWORK"
              ? "WRONG_NETWORK"
              : "CHAIN_UNAVAILABLE",
          message:
            "The pinned signing chain or wallet is unavailable. The saved journal state is shown without assuming confirmation.",
        },
      };
    }
  }

  async prepare(request) {
    validateRequest(request, this.identity, this.now());
    const existing = this.store.get(request.id);
    if (existing) {
      requirePolicy(
        existing.request.requestHash === request.requestHash,
        "IDEMPOTENCY_CONFLICT",
        "This request ID has already been used with different payment details.",
      );
      requirePolicy(
        !["preparing", "preparation_uncertain"].includes(existing.state),
        "PREPARATION_UNCERTAIN",
        "Preparation did not finish. Inspect signing wallet reservations before continuing.",
      );
      return this.review(existing);
    }
    await this.checkNetwork();
    const record = {
      id: request.id,
      state: "preparing",
      request: structuredClone(request),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.store.create(record);
    try {
      const changeAddress = await this.rpc(
        this.role,
        "getrawchangeaddress",
        [],
        this.role,
      );
      const funded = await this.rpc(
        this.role,
        "walletcreatefundedpsbt",
        [
          [],
          [{ [request.address]: request.amount }],
          0,
          {
            add_inputs: true,
            include_unsafe: false,
            includeWatching: false,
            changeAddress,
            lockUnspents: true,
            fee_rate: "1",
            subtractFeeFromOutputs: [],
          },
          false,
        ],
        this.role,
      );
      Object.assign(record, { changeAddress, psbt: funded.psbt });
      const inspected = await this.inspect(record);
      Object.assign(record, inspected);
      // Upgrade exactly this draft's temporary locks to persistent locks. Never unlock
      // all wallet coins: other drafts may own other reservations.
      await this.rpc(
        this.role,
        "lockunspent",
        [false, inspected.outpoints, true],
        this.role,
      );
      record.fingerprint = digest({
        requestHash: request.requestHash,
        templateHash: inspected.templateHash,
        feeSats: inspected.feeSats,
        network: this.identity,
      });
      record.state = "prepared";
      this.store.put(record);
      return this.review(record);
    } catch (error) {
      record.state = "preparation_uncertain";
      record.error = error.code || "PREPARATION_FAILED";
      this.store.put(record);
      throw error;
    }
  }

  async approve(id, decide) {
    requirePolicy(
      typeof decide === "function",
      "APPROVAL_REQUIRED",
      "A wallet owner approval decision is required.",
    );
    let record = this.required(id);
    if (record.state === "broadcast") return this.review(record);
    requirePolicy(
      ["prepared", "signed", "broadcast_unknown", "broadcasting"].includes(
        record.state,
      ),
      "OPERATION_BUSY",
      "This draft is not available for signing; inspect its stored state.",
    );
    await this.checkNetwork();
    if (record.txid && (await this.knownTransaction(record.txid))) {
      record.state = "broadcast";
      this.store.put(record);
      return this.review(record);
    }
    validateRequest(record.request, this.identity, this.now());
    if (record.state === "prepared") await this.inspect(record);
    const originalState = record.state;
    record = this.store.claim(id, [originalState], "awaiting_approval");
    let accepted;
    try {
      accepted = await decide(Object.freeze(this.review(record)));
    } catch (error) {
      record.state = originalState;
      this.store.put(record);
      throw error;
    }
    if (accepted !== true) {
      record.state = originalState;
      this.store.put(record);
      throw new SignerError(
        "APPROVAL_DENIED",
        "Wallet owner declined; no transaction was signed or broadcast.",
      );
    }
    try {
      await this.checkNetwork();
      validateRequest(record.request, this.identity, this.now());
      if (!record.rawHex) {
        await this.inspect(record);
        record.state = "signing";
        this.store.put(record);
        const signed = await this.rpc(
          this.role,
          "walletprocesspsbt",
          [record.psbt, true, "ALL", false, true],
          this.role,
        );
        requirePolicy(
          signed.complete,
          "INCOMPLETE_SIGNATURES",
          "The signing wallet could not sign every input.",
        );
        const finalized = await this.rpc(this.role, "finalizepsbt", [
          signed.psbt,
          true,
        ]);
        requirePolicy(
          finalized.complete && typeof finalized.hex === "string",
          "INCOMPLETE_SIGNATURES",
          "PSBT could not be finalized.",
        );
        const transaction = await this.rpc(this.role, "decoderawtransaction", [
          finalized.hex,
        ]);
        requirePolicy(
          digest(transactionTemplate(transaction)) === record.templateHash,
          "TRANSACTION_CHANGED",
          "The signed transaction differs from the approved transaction.",
        );
        requirePolicy(
          BigInt(record.feeSats) <= BigInt(transaction.size) * MAX_FEE_RATE,
          "EXCESSIVE_FEE",
          "Final transaction fee rate exceeds policy.",
        );
        record.rawHex = finalized.hex;
        record.txid = transaction.txid;
        record.state = "signed";
        record.approvedAt = new Date(this.now()).toISOString();
        this.store.put(record);
      } else {
        const transaction = await this.rpc(this.role, "decoderawtransaction", [
          record.rawHex,
        ]);
        requirePolicy(
          transaction.txid === record.txid &&
            digest(transactionTemplate(transaction)) === record.templateHash,
          "TRANSACTION_CHANGED",
          "Stored signed transaction changed.",
        );
        record.state = "signed";
        this.store.put(record);
      }
      await this.checkNetwork();
      validateRequest(record.request, this.identity, this.now());
      const [acceptance] = await this.rpc(this.role, "testmempoolaccept", [
        [record.rawHex],
        "0.0001",
      ]);
      requirePolicy(
        acceptance?.allowed,
        "MEMPOOL_REJECTED",
        `The prepared transaction is not accepted by the node (${acceptance?.["reject-reason"] || "unknown reason"}).`,
      );
      record.state = "broadcasting";
      this.store.put(record);
      try {
        const txid = await this.rpc(this.role, "sendrawtransaction", [
          record.rawHex,
          "0.0001",
        ]);
        requirePolicy(
          txid === record.txid,
          "TRANSACTION_CHANGED",
          "Node returned an unexpected transaction ID.",
        );
        record.state = "broadcast";
        this.store.put(record);
      } catch (error) {
        record.state = "broadcast_unknown";
        this.store.put(record);
        throw new SignerError(
          "BROADCAST_UNCERTAIN",
          "Broadcast outcome is unknown. The signed bytes and transaction ID are saved; retry can only reconcile or rebroadcast this exact transaction.",
        );
      }
      return this.review(record);
    } catch (error) {
      if (record.state === "awaiting_approval") {
        record.state = originalState;
        this.store.put(record);
      }
      throw error;
    }
  }

  async knownTransaction(txid) {
    try {
      const tx = await this.rpc(this.role, "gettransaction", [txid], this.role);
      if (
        tx.confirmations < 0 ||
        tx.abandoned ||
        tx.details?.some((detail) => detail.abandoned)
      )
        return false;
      if (tx.confirmations >= 1) return true;
      await this.rpc(this.role, "getmempoolentry", [txid]);
      return true;
    } catch (error) {
      if (error.code === -5 || error.rpcCode === -5) return false;
      throw error;
    }
  }

  async cancel(id) {
    let record = this.required(id);
    if (record.state === "cancelled") return this.review(record);
    requirePolicy(
      ["prepared", "cancelling"].includes(record.state) &&
        !record.rawHex &&
        !record.txid,
      "CANNOT_CANCEL",
      "Only an unsigned prepared draft can be cancelled. Signed or uncertain operations require inspection.",
    );
    await this.checkNetwork();
    record = this.store.claim(id, ["prepared", "cancelling"], "cancelling");
    const locked = await this.rpc(this.role, "listlockunspent", [], this.role);
    const ownLocks = record.outpoints.filter((point) =>
      locked.some(
        (item) => point.txid === item.txid && point.vout === item.vout,
      ),
    );
    if (ownLocks.length)
      await this.rpc(this.role, "lockunspent", [true, ownLocks], this.role);
    record.state = "cancelled";
    this.store.put(record);
    return this.review(record);
  }
}

export async function createPaymentRequest({
  rpc,
  assertNode,
  identity,
  amount,
  merchantName,
  description,
  expiresInMinutes = 60,
  now = Date.now(),
}) {
  const amountSats = parseAmount(amount);
  requirePolicy(
    Number.isInteger(expiresInMinutes) &&
      expiresInMinutes >= 1 &&
      expiresInMinutes <= 10080,
    "INVALID_REQUEST",
    "Expiry must be 1–10080 minutes.",
  );
  const verifier = new CustomerSigner({
    rpc,
    assertNode,
    identity,
    role: "merchant",
  });
  await verifier.checkNetwork("merchant");
  const id = randomUUID();
  const address = await rpc(
    "merchant",
    "getnewaddress",
    [`atlas-request:${id}`],
    "merchant",
  );
  const request = {
    version: 1,
    id,
    merchantName,
    description,
    address,
    amount: formatAmount(amountSats),
    amountSats: amountSats.toString(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresInMinutes * 60_000).toISOString(),
    network: structuredClone(identity),
  };
  request.requestHash = requestDigest(request);
  validateRequest(request, identity, now);
  return request;
}
