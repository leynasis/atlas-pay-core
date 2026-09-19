import { createHash } from "node:crypto";
import { parseAmount, rpcAmount, formatAmount } from "../server/money.mjs";

export const MAX_FEE_SATS = 10_000n;
export const MAX_FEE_RATE = 10n;
export class SignerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SignerError";
    this.code = code;
  }
}
export function requirePolicy(condition, code, message) {
  if (!condition) throw new SignerError(code, message);
}
export function canonical(value) {
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
export function digest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
}
export function requestDigest(request) {
  const { requestHash, ...fields } = request;
  return digest(fields);
}

export function validateRequest(request, identity, now = Date.now()) {
  requirePolicy(
    request &&
      typeof request === "object" &&
      !Array.isArray(request) &&
      request.version === 1,
    "INVALID_REQUEST",
    "Unsupported payment request.",
  );
  requirePolicy(
    typeof request.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        request.id,
      ),
    "INVALID_REQUEST",
    "Request ID must be a UUID.",
  );
  requirePolicy(
    request.requestHash === requestDigest(request),
    "REQUEST_CHANGED",
    "The payment request checksum does not match its contents.",
  );
  requirePolicy(
    canonical(request.network) === canonical(identity),
    "WRONG_NETWORK",
    "Payment request belongs to a different blockchain.",
  );
  requirePolicy(
    typeof request.address === "string" &&
      /^[A-Za-z0-9]{20,90}$/.test(request.address),
    "INVALID_REQUEST",
    "Invalid payment address.",
  );
  requirePolicy(
    typeof request.merchantName === "string" &&
      request.merchantName.length > 0 &&
      request.merchantName.length <= 80 &&
      typeof request.description === "string" &&
      request.description.length > 0 &&
      request.description.length <= 280,
    "INVALID_REQUEST",
    "Invalid merchant or description.",
  );
  requirePolicy(
    !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
      request.merchantName + request.description,
    ),
    "UNSAFE_TEXT",
    "Merchant text cannot contain terminal or bidirectional control characters.",
  );
  let amount;
  try {
    amount = parseAmount(request.amount);
  } catch {
    throw new SignerError(
      "INVALID_AMOUNT",
      "Payment amount must be exact decimal text.",
    );
  }
  requirePolicy(
    request.amountSats === amount.toString(),
    "AMOUNT_CHANGED",
    "Decimal amount and satoshi amount disagree.",
  );
  const created = Date.parse(request.createdAt);
  const expiry = Date.parse(request.expiresAt);
  requirePolicy(
    Number.isFinite(created) &&
      Number.isFinite(expiry) &&
      expiry > created &&
      created <= now + 60_000 &&
      expiry - created <= 7 * 86400_000,
    "INVALID_REQUEST",
    "Invalid request timestamps.",
  );
  requirePolicy(
    expiry > now,
    "REQUEST_EXPIRED",
    "Payment request has expired.",
  );
  return amount;
}

export function transactionTemplate(tx) {
  return {
    version: tx.version,
    type: tx.type,
    locktime: tx.locktime,
    extraPayload: tx.extraPayload || "",
    vin: tx.vin.map((input) => ({
      txid: input.txid,
      vout: input.vout,
      sequence: input.sequence,
    })),
    vout: tx.vout.map((output) => ({
      amountSats: rpcAmount(output.value).toString(),
      script: output.scriptPubKey.hex,
    })),
  };
}

export async function inspectPsbt({
  request,
  psbt,
  changeAddress,
  identity,
  rpc,
  now = Date.now(),
  expectedTemplateHash,
}) {
  const amount = validateRequest(request, identity, now);
  requirePolicy(
    typeof psbt === "string" && psbt.length <= 200_000,
    "INVALID_PSBT",
    "PSBT exceeds the supported size.",
  );
  const decoded = await rpc("customer", "decodepsbt", [psbt]);
  const tx = decoded.tx;
  requirePolicy(
    decoded.psbt_version === 0 &&
      tx.type === 0 &&
      !tx.extraPayload &&
      tx.locktime === 0,
    "INVALID_PSBT",
    "Only ordinary unlocked PSBT v0 payments are supported.",
  );
  requirePolicy(
    tx.vin.length > 0 &&
      tx.vin.length <= 20 &&
      tx.vout.length >= 1 &&
      tx.vout.length <= 2 &&
      decoded.inputs.length === tx.vin.length,
    "INVALID_PSBT",
    "Unexpected transaction input/output count.",
  );
  const destination = await rpc("customer", "validateaddress", [
    request.address,
  ]);
  requirePolicy(
    destination.isvalid && destination.scriptPubKey,
    "INVALID_ADDRESS",
    "Destination is not valid on the selected network.",
  );
  const change = await rpc(
    "customer",
    "getaddressinfo",
    [changeAddress],
    "customer",
  );
  requirePolicy(
    change.ismine &&
      !change.iswatchonly &&
      change.ischange &&
      change.scriptPubKey !== destination.scriptPubKey,
    "UNOWNED_CHANGE",
    "Change must belong to the customer change wallet.",
  );
  let totalOutputs = 0n;
  let merchantOutputs = 0;
  let changeOutputs = 0;
  let changeSats = 0n;
  for (const output of tx.vout) {
    const value = rpcAmount(output.value);
    totalOutputs += value;
    if (output.scriptPubKey.hex === destination.scriptPubKey) {
      merchantOutputs++;
      requirePolicy(
        value === amount,
        "AMOUNT_CHANGED",
        "Merchant output differs from the requested amount.",
      );
    } else {
      changeOutputs++;
      changeSats += value;
      requirePolicy(
        output.scriptPubKey.hex === change.scriptPubKey,
        "UNOWNED_CHANGE",
        "Unexpected output or unowned change.",
      );
    }
  }
  requirePolicy(
    merchantOutputs === 1 && changeOutputs <= 1,
    "INVALID_OUTPUTS",
    "Expected one merchant output and at most one customer change output.",
  );
  const outpoints = [];
  let totalInputs = 0n;
  const seen = new Set();
  for (let i = 0; i < tx.vin.length; i++) {
    const input = tx.vin[i];
    const metadata = decoded.inputs[i];
    const key = `${input.txid}:${input.vout}`;
    requirePolicy(
      /^[0-9a-f]{64}$/.test(input.txid) &&
        Number.isInteger(input.vout) &&
        input.vout >= 0 &&
        !seen.has(key) &&
        !input.coinbase &&
        !input.scriptSig?.hex,
      "INVALID_INPUTS",
      "Unexpected or duplicated transaction input.",
    );
    seen.add(key);
    requirePolicy(
      !metadata.sighash || metadata.sighash === "ALL",
      "UNSAFE_SIGHASH",
      "Only SIGHASH_ALL is permitted.",
    );
    requirePolicy(
      !metadata.final_scriptSig &&
        !Object.keys(metadata.partial_signatures || {}).length,
      "PRE_SIGNED_PSBT",
      "Imported signatures are not accepted.",
    );
    const utxo = await rpc("customer", "gettxout", [
      input.txid,
      input.vout,
      true,
    ]);
    requirePolicy(
      utxo && utxo.confirmations >= 1,
      "INPUT_UNAVAILABLE",
      "Every input must be confirmed and unspent.",
    );
    const address = utxo.scriptPubKey.address;
    requirePolicy(
      typeof address === "string",
      "UNOWNED_INPUT",
      "Unsupported input script.",
    );
    const owner = await rpc(
      "customer",
      "getaddressinfo",
      [address],
      "customer",
    );
    requirePolicy(
      owner.ismine &&
        !owner.iswatchonly &&
        owner.scriptPubKey === utxo.scriptPubKey.hex,
      "UNOWNED_INPUT",
      "Every input must belong to the customer wallet.",
    );
    const previous = metadata.non_witness_utxo;
    const previousOutput = previous?.vout?.[input.vout];
    requirePolicy(
      previous?.txid === input.txid &&
        previousOutput &&
        rpcAmount(previousOutput.value) === rpcAmount(utxo.value) &&
        previousOutput.scriptPubKey.hex === utxo.scriptPubKey.hex,
      "UTXO_MISMATCH",
      "PSBT input data does not match the actual unspent output.",
    );
    totalInputs += rpcAmount(utxo.value);
    outpoints.push({ txid: input.txid, vout: input.vout });
  }
  const fee = totalInputs - totalOutputs;
  requirePolicy(
    fee >= 0n &&
      fee <= MAX_FEE_SATS &&
      fee <= BigInt(tx.size) * MAX_FEE_RATE &&
      rpcAmount(decoded.fee) === fee,
    "EXCESSIVE_FEE",
    "Transaction fee exceeds policy or does not match input/output amounts.",
  );
  const templateHash = digest(transactionTemplate(tx));
  requirePolicy(
    !expectedTemplateHash || expectedTemplateHash === templateHash,
    "TRANSACTION_CHANGED",
    "Prepared transaction changed after review.",
  );
  return {
    templateHash,
    outpoints,
    amountSats: amount.toString(),
    feeSats: fee.toString(),
    amount: formatAmount(amount),
    fee: formatAmount(fee),
    total: formatAmount(amount + fee),
    changeAmount: formatAmount(changeSats),
    changeAddress,
  };
}
