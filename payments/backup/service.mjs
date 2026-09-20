import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  chmod,
  open,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonical, requestDigest, SignerError } from "../signer/policy.mjs";
import {
  encryptBackup,
  decryptBackup,
  sha256,
  MAX_FILE_BYTES,
  validateBackupPassword,
} from "./crypto.mjs";
import { withWalletGate } from "./gate.mjs";
import { networkProfile, profileIdentity } from "../lab/profiles.mjs";

const PINNED_NETWORK = profileIdentity(networkProfile("lave"));

const stableStates = new Set([
  "prepared",
  "signed",
  "broadcast_unknown",
  "broadcast",
  "cancelled",
]);
function requireBackup(test, code, message) {
  if (!test) throw new SignerError(code, message);
}
function sqliteFile(bytes) {
  return bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"));
}
function requireLaveWallet(bytes) {
  requireBackup(
    sqliteFile(bytes) &&
      bytes.length >= 100 &&
      bytes.readUInt32BE(68) === 0xfa4c56b9,
    "BACKUP_IDENTITY_MISMATCH",
    "Wallet database is not the pinned LAVE wallet format. Dash/Atlas wallet databases cannot be restored as LAVE.",
  );
}
async function boundedRead(path) {
  const info = await stat(path);
  requireBackup(
    info.isFile() && info.size > 0 && info.size <= MAX_FILE_BYTES,
    "BACKUP_TOO_LARGE",
    "Wallet or journal exceeds the backup size limit.",
  );
  return readFile(path);
}

export function validateJournal(db, network) {
  const integrity = db.prepare("PRAGMA quick_check").all();
  requireBackup(
    integrity.length === 1 && Object.values(integrity[0])[0] === "ok",
    "INVALID_BACKUP",
    "Signing journal integrity check failed.",
  );
  const rows = db
    .prepare("SELECT id,hash,state,data FROM requests LIMIT 10001")
    .all();
  requireBackup(
    rows.length <= 10000,
    "BACKUP_TOO_LARGE",
    "Signing journal exceeds the supported record limit.",
  );
  for (const row of rows) {
    const record = JSON.parse(row.data);
    requireBackup(
      stableStates.has(row.state) && record.state === row.state,
      "BACKUP_STATE_UNCERTAIN",
      "An unfinished signing operation requires inspection before backup or recovery.",
    );
    requireBackup(
      record.id === row.id &&
        record.request?.id === row.id &&
        record.request?.requestHash === row.hash &&
        requestDigest(record.request) === row.hash &&
        canonical(record.request.network) === canonical(network),
      "BACKUP_IDENTITY_MISMATCH",
      "Signing journal contains an inconsistent request or another blockchain.",
    );
    if (["signed", "broadcast_unknown", "broadcast"].includes(row.state))
      requireBackup(
        typeof record.rawHex === "string" &&
          /^(?:[0-9a-f]{2})+$/.test(record.rawHex) &&
          record.rawHex.length <= 2000000 &&
          /^[0-9a-f]{64}$/.test(record.txid),
        "BACKUP_STATE_UNCERTAIN",
        "A signed journal entry is missing its exact transaction bytes.",
      );
    else
      requireBackup(
        !record.rawHex && !record.txid,
        "BACKUP_STATE_UNCERTAIN",
        "Unsigned journal state contains a signed transaction.",
      );
  }
  const imports = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_imports'",
    )
    .get();
  if (imports)
    requireBackup(
      !db
        .prepare(
          "SELECT 1 FROM wallet_imports i LEFT JOIN requests r ON r.id=i.request_id WHERE r.id IS NULL LIMIT 1",
        )
        .get(),
      "BACKUP_STATE_UNCERTAIN",
      "An unfinished imported request requires inspection before backup.",
    );
  return rows.map((row) => ({
    id: row.id,
    state: row.state,
    txid: JSON.parse(row.data).txid || null,
  }));
}

export async function createWalletBackup({
  signer,
  store,
  journalPath,
  password,
}) {
  requireBackup(
    canonical(signer.identity) === canonical(PINNED_NETWORK),
    "BACKUP_PROFILE_UNSUPPORTED",
    "Encrypted descriptor-wallet backups currently support only the pinned LAVE profile.",
  );
  validateBackupPassword(password);
  return withWalletGate(journalPath, async () => {
    const chain = await signer.checkNetwork();
    const info = await signer.rpc(
      signer.role,
      "getwalletinfo",
      [],
      signer.role,
    );
    requireBackup(
      info.descriptors === true &&
        info.private_keys_enabled === true &&
        !info.scanning,
      "BACKUP_WALLET_UNSUPPORTED",
      "Backup requires an idle descriptor signing wallet with private keys.",
    );
    const records = validateJournal(store.db, signer.identity);
    const workspace = await mkdtemp(
      join(dirname(resolve(journalPath)), ".backup-"),
    );
    await chmod(workspace, 0o700);
    let wallet, journal;
    try {
      const walletPath = join(workspace, "wallet.dat");
      const journalCopy = join(workspace, "signer.sqlite");
      await signer.rpc(signer.role, "backupwallet", [walletPath], signer.role);
      store.db.prepare("VACUUM INTO ?").run(journalCopy);
      await chmod(walletPath, 0o600);
      await chmod(journalCopy, 0o600);
      [wallet, journal] = await Promise.all([
        boundedRead(walletPath),
        boundedRead(journalCopy),
      ]);
      requireBackup(
        sqliteFile(wallet) && sqliteFile(journal),
        "BACKUP_WALLET_UNSUPPORTED",
        "Backup did not contain the expected SQLite wallet and journal.",
      );
      requireLaveWallet(wallet);
      const after = await signer.rpc(
        signer.role,
        "getwalletinfo",
        [],
        signer.role,
      );
      requireBackup(
        after.descriptors === true &&
          after.private_keys_enabled === true &&
          !after.scanning &&
          after.txcount === info.txcount,
        "BACKUP_WALLET_CHANGED",
        "Wallet activity changed during capture. Retry once wallet activity is idle.",
      );
      await signer.checkNetwork();
      const metadata = {
        version: 1,
        profile: "lave",
        role: signer.role,
        network: structuredClone(signer.identity),
        createdAt: new Date().toISOString(),
        walletType: "descriptor-sqlite",
        recoveryPolicy: "saved-transactions-only",
        chainSnapshot: { height: chain.blocks, hash: chain.bestblockhash },
        records: records.length,
      };
      const bytes = await encryptBackup({
        password,
        metadata,
        wallet,
        journal,
      });
      return {
        bytes,
        filename: `lave-${signer.role}-${metadata.createdAt.replace(/[:.]/g, "-")}.lavebackup`,
        metadata,
      };
    } finally {
      wallet?.fill(0);
      journal?.fill(0);
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

async function durableWrite(path, data) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

// Recovery never overwrites a running wallet/journal. The extracted copy is
// locked against fresh signatures even if its snapshot predates later payments.
export async function restoreWalletBackup({
  bytes,
  password,
  directory,
  role,
  network,
}) {
  requireBackup(
    canonical(network) === canonical(PINNED_NETWORK),
    "BACKUP_PROFILE_UNSUPPORTED",
    "Recovery requires the pinned LAVE profile.",
  );
  const decoded = await decryptBackup({ bytes, password, role, network });
  const target = resolve(directory);
  let created = false;
  try {
    requireBackup(
      sqliteFile(decoded.wallet) && sqliteFile(decoded.journal),
      "INVALID_BACKUP",
      "Backup does not contain SQLite wallet and journal files.",
    );
    requireLaveWallet(decoded.wallet);
    try {
      await mkdir(target, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error.code === "EEXIST")
        throw new SignerError(
          "RECOVERY_TARGET_EXISTS",
          "Recovery target must be a new directory. Existing wallets and journals are never overwritten.",
        );
      throw error;
    }
    const walletPath = join(target, "wallet.dat"),
      journalPath = join(target, "signer.sqlite");
    await durableWrite(walletPath, decoded.wallet);
    await durableWrite(journalPath, decoded.journal);
    const db = new DatabaseSync(journalPath);
    let records;
    const recovery = {
      version: 1,
      role,
      network,
      backupCreatedAt: decoded.metadata.createdAt,
      restoredAt: new Date().toISOString(),
      backupSha256: sha256(bytes),
      policy: "saved-transactions-only",
      reason:
        "A snapshot cannot account for payments made after its creation. New signatures remain blocked.",
    };
    try {
      records = validateJournal(db, network);
      db.exec(
        "PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS backup_recovery(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);",
      );
      db.prepare(
        "INSERT OR REPLACE INTO backup_recovery(id,data) VALUES(1,?)",
      ).run(JSON.stringify(recovery));
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    await durableWrite(
      join(target, "recovery.json"),
      JSON.stringify({ ...recovery, records }, null, 2),
    );
    const handle = await open(target, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      directory: target,
      walletPath,
      journalPath,
      recoveryLocked: true,
      role,
      network,
      records: records.length,
    };
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    decoded.wallet.fill(0);
    decoded.journal.fill(0);
  }
}
