import { rpcAmount, formatAmount } from "../server/money.mjs";
import { canonical, digest, requirePolicy } from "../signer/policy.mjs";
import { COLLATERAL_SATS, MAX_FEE_SATS, IDENTITY } from "./config.mjs";
export const outpointKey = (coin) => `${coin.txid}:${coin.vout}`;
export function registrationBody(tx) {
  const raw = tx.extraPayload || "";
  requirePolicy(
    /^(?:[0-9a-f]{2})+$/.test(raw),
    "INVALID_PAYLOAD",
    "Missing registration payload.",
  );
  // ProRegTx ends in a CompactSize-prefixed collateral signature. Preparation
  // has length zero; submission adds exactly one 65-byte compact signature.
  if (tx.vin.some((input) => input.scriptSig?.hex)) {
    if (raw.length >= 132 && raw.slice(-132, -130) === "41")
      return raw.slice(0, -132);
  } else if (raw.endsWith("00")) return raw.slice(0, -2);
  requirePolicy(
    false,
    "INVALID_PAYLOAD",
    "Unexpected collateral signature encoding.",
  );
}
export function stakingTemplate(tx) {
  return {
    version: tx.version,
    type: tx.type,
    locktime: tx.locktime,
    vin: tx.vin.map((v) => ({
      txid: v.txid,
      vout: v.vout,
      sequence: v.sequence,
    })),
    vout: tx.vout.map((v) => ({
      value: rpcAmount(v.value).toString(),
      script: v.scriptPubKey.hex,
    })),
    payload:
      tx.type === 1
        ? { fields: tx.proRegTx, body: registrationBody(tx) }
        : tx.extraPayload || "",
  };
}
export function reviewFingerprint(record) {
  return digest({
    id: record.id,
    generation: record.generation,
    role: record.role,
    kind: record.kind,
    network: record.network,
    templateHash: record.templateHash,
    fee: record.fee,
    service: record.service,
    expiresAt: record.expiresAt,
  });
}
export async function inspectTransaction({
  tx,
  record,
  node,
  rpc,
  signed = false,
  allowSpent = false,
}) {
  requirePolicy(
    canonical(record.network) === canonical(IDENTITY),
    "WRONG_NETWORK",
    "Masternode transaction belongs to another chain.",
  );
  requirePolicy(
    tx.locktime === 0 &&
      tx.vin?.length > 0 &&
      tx.vin.length <= 100 &&
      tx.vout?.length > 0 &&
      tx.vout.length <= 2,
    "INVALID_TRANSACTION",
    "Unsupported masternode transaction structure.",
  );
  requirePolicy(
    tx.type === (record.kind === "register" ? 1 : 0) &&
      (record.kind === "register" || !tx.extraPayload),
    "INVALID_TRANSACTION",
    "Wrong masternode transaction type.",
  );
  const seen = new Set();
  let inputSum = 0n;
  for (const input of tx.vin) {
    const key = outpointKey(input);
    requirePolicy(
      /^[0-9a-f]{64}$/.test(input.txid) &&
        Number.isInteger(input.vout) &&
        input.vout >= 0 &&
        !seen.has(key) &&
        !input.coinbase &&
        (signed || !input.scriptSig?.hex),
      "INVALID_INPUTS",
      "Unexpected or pre-signed input.",
    );
    seen.add(key);
    const utxo = await rpc("gettxout", [input.txid, input.vout, true]);
    if (!utxo && allowSpent) continue;
    requirePolicy(
      utxo && utxo.confirmations >= 1,
      "INPUT_UNAVAILABLE",
      "Every masternode input must be confirmed and unspent.",
    );
    const owner = await rpc(
      "getaddressinfo",
      [utxo.scriptPubKey.address],
      true,
    );
    requirePolicy(
      owner.ismine === true &&
        !owner.iswatchonly &&
        owner.scriptPubKey === utxo.scriptPubKey.hex,
      "UNOWNED_INPUT",
      "Masternode transaction input is not owned by this wallet.",
    );
    inputSum += rpcAmount(utxo.value);
    if (record.kind !== "retire" && node.collateral)
      requirePolicy(
        key !== outpointKey(node.collateral),
        "COLLATERAL_SPEND",
        "Registered collateral cannot fund fees or payments.",
      );
  }
  let outputSum = 0n,
    collateralOutputs = 0;
  for (const output of tx.vout) {
    const amount = rpcAmount(output.value);
    outputSum += amount;
    const address = output.scriptPubKey.address;
    requirePolicy(
      typeof address === "string",
      "UNOWNED_OUTPUT",
      "Only owned address outputs are allowed.",
    );
    const owned = await rpc("getaddressinfo", [address], true);
    requirePolicy(
      owned.ismine === true &&
        !owned.iswatchonly &&
        owned.scriptPubKey === output.scriptPubKey.hex,
      "UNOWNED_OUTPUT",
      "Masternode outputs must belong to the approving wallet.",
    );
    if (record.kind === "collateral" && address === node.collateralAddress) {
      collateralOutputs++;
      requirePolicy(
        amount === COLLATERAL_SATS,
        "COLLATERAL_AMOUNT",
        "Collateral must be exactly 1000 LAVE.",
      );
    } else
      requirePolicy(
        address === record.changeAddress ||
          (record.kind === "retire" && address === record.returnAddress),
        "OUTPUT_CHANGED",
        "Unexpected transaction destination.",
      );
  }
  if (record.kind === "collateral")
    requirePolicy(
      collateralOutputs === 1,
      "COLLATERAL_AMOUNT",
      "Exactly one collateral output is required.",
    );
  if (record.kind === "retire")
    requirePolicy(
      tx.vin.length === 1 &&
        seen.has(outpointKey(node.collateral)) &&
        tx.vout.length === 1,
      "INVALID_RETIREMENT",
      "Retirement must spend only the reserved collateral to this wallet.",
    );
  if (record.kind === "register") {
    const feeOwner = await rpc("getaddressinfo", [record.changeAddress], true);
    requirePolicy(
      feeOwner.ismine === true &&
        !feeOwner.iswatchonly &&
        feeOwner.ischange === true,
      "UNSAFE_FEE_SOURCE",
      "Registration change must return to an internal wallet address, never an invoice address.",
    );
    const p = tx.proRegTx;
    requirePolicy(
      tx.version === 3 &&
        p &&
        p.type === 0 &&
        p.collateralHash === node.collateral.txid &&
        p.collateralIndex === node.collateral.vout &&
        p.service === node.service &&
        p.ownerAddress === node.ownerAddress &&
        p.votingAddress === node.votingAddress &&
        p.payoutAddress === node.payoutAddress &&
        p.pubKeyOperator === node.operator.public &&
        Number(p.operatorReward) === 0,
      "REGISTRATION_CHANGED",
      "Masternode registration does not match its approved ownership and service.",
    );
  }
  const hash = digest(stakingTemplate(tx));
  requirePolicy(
    !record.templateHash || record.templateHash === hash,
    "TRANSACTION_CHANGED",
    "Masternode transaction changed after preparation.",
  );
  if (allowSpent) return { templateHash: hash };
  const fee = inputSum - outputSum;
  requirePolicy(
    fee > 0n && fee <= MAX_FEE_SATS,
    "EXCESSIVE_FEE",
    "Masternode transaction fee exceeds the 0.0001 LAVE limit.",
  );
  return {
    templateHash: hash,
    fee: formatAmount(fee),
    feeSats: fee.toString(),
    total: formatAmount(
      record.kind === "collateral"
        ? COLLATERAL_SATS + fee
        : record.kind === "retire"
          ? outputSum
          : fee,
    ),
    outpoints: tx.vin.map(({ txid, vout }) => ({ txid, vout })),
  };
}
