import { createHash } from "node:crypto";
import { canonical, requirePolicy } from "../signer/policy.mjs";
import { reviewFingerprint } from "./policy.mjs";
import { stakingConfig } from "./config.mjs";

export function signedTransactionId(rawHex) {
  const first = createHash("sha256")
    .update(Buffer.from(rawHex, "hex"))
    .digest();
  return Buffer.from(createHash("sha256").update(first).digest())
    .reverse()
    .toString("hex");
}
export function validateStakingJournal(db, network, role) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('staking_state','staking_requests')",
    )
    .all();
  if (!tables.length) return { nodes: 0, requests: 0 };
  requirePolicy(
    tables.length === 2,
    "BACKUP_STATE_UNCERTAIN",
    "Masternode journal tables are incomplete.",
  );
  const row = db.prepare("SELECT data FROM staking_state WHERE id=1").get();
  const node = row ? JSON.parse(row.data) : null;
  if (node) {
    requirePolicy(
      node.format === 1 &&
        ["customer", "merchant"].includes(node.role) &&
        (role === undefined || node.role === role) &&
        canonical(node.network) === canonical(network),
      "BACKUP_IDENTITY_MISMATCH",
      "Masternode role or network differs from backup.",
    );
    const config = stakingConfig(node.role);
    requirePolicy(
      node.id === config.id &&
        node.service === config.service &&
        typeof node.generation === "string" &&
        /^[0-9a-f]{64}$/.test(node.operator?.secret || "") &&
        /^[0-9a-f]{96}$/.test(node.operator?.public || ""),
      "BACKUP_IDENTITY_MISMATCH",
      "Masternode operator or local endpoint is invalid.",
    );
    for (const key of [
      "collateralAddress",
      "ownerAddress",
      "votingAddress",
      "payoutAddress",
    ])
      requirePolicy(
        /^[A-Za-z0-9]{20,90}$/.test(node[key] || ""),
        "BACKUP_IDENTITY_MISMATCH",
        "Masternode owner address is invalid.",
      );
    if (node.collateral)
      requirePolicy(
        /^[0-9a-f]{64}$/.test(node.collateral.txid) &&
          Number.isInteger(node.collateral.vout) &&
          node.collateral.vout >= 0,
        "BACKUP_IDENTITY_MISMATCH",
        "Masternode collateral outpoint is invalid.",
      );
  }
  const rows = db
    .prepare("SELECT id,state,data FROM staking_requests LIMIT 10001")
    .all();
  requirePolicy(
    rows.length <= 10000,
    "BACKUP_TOO_LARGE",
    "Too many masternode journal entries.",
  );
  for (const row of rows) {
    const record = JSON.parse(row.data);
    requirePolicy(
      node &&
        record.id === row.id &&
        record.state === row.state &&
        record.role === node.role &&
        canonical(record.network) === canonical(network) &&
        ["collateral", "register", "retire"].includes(record.kind),
      "BACKUP_IDENTITY_MISMATCH",
      "Masternode request identity differs from backup.",
    );
    requirePolicy(
      [
        "prepared",
        "signed",
        "broadcast_unknown",
        "broadcast",
        "confirmed",
        "cancelled",
      ].includes(record.state),
      "BACKUP_STATE_UNCERTAIN",
      "An unfinished masternode operation needs inspection before backup.",
    );
    requirePolicy(
      record.fingerprint === reviewFingerprint(record) &&
        /^[0-9a-f]{64}$/.test(record.templateHash || ""),
      "BACKUP_IDENTITY_MISMATCH",
      "Masternode request fingerprint is inconsistent.",
    );
    if (
      ["signed", "broadcast_unknown", "broadcast", "confirmed"].includes(
        record.state,
      )
    )
      requirePolicy(
        typeof record.rawHex === "string" &&
          record.rawHex.length <= 2000000 &&
          /^(?:[0-9a-f]{2})+$/.test(record.rawHex) &&
          signedTransactionId(record.rawHex) === record.txid,
        "BACKUP_STATE_UNCERTAIN",
        "Masternode signed transaction bytes or transaction ID are inconsistent.",
      );
    else
      requirePolicy(
        !record.rawHex && !record.txid,
        "BACKUP_STATE_UNCERTAIN",
        "Unsigned masternode request unexpectedly contains signed bytes.",
      );
  }
  return { nodes: node ? 1 : 0, requests: rows.length };
}
