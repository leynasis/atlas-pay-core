import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { canonical, SignerError } from "../signer/policy.mjs";

const derive = promisify(scrypt);
const MAGIC = Buffer.from("LAVEBK01");
const KDF = Object.freeze({ name: "scrypt", N: 32768, r: 8, p: 1 });
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;

function fail(code, message) {
  throw new SignerError(code, message);
}
export function validateBackupPassword(password) {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") < 12 ||
    Buffer.byteLength(password, "utf8") > 1024
  )
    fail(
      "INVALID_BACKUP_PASSWORD",
      "Use a backup password of 12–1024 UTF-8 bytes.",
    );
}
function passwordBytes(password) {
  validateBackupPassword(password);
  return Buffer.from(password, "utf8");
}
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function metadataValid(metadata) {
  if (
    !metadata ||
    metadata.version !== 1 ||
    metadata.profile !== "lave" ||
    !["customer", "merchant"].includes(metadata.role) ||
    metadata.network?.currency !== "LAVE" ||
    typeof metadata.network?.chain !== "string" ||
    !/^[0-9a-f]{64}$/.test(metadata.network?.genesisHash) ||
    !/^[0-9a-f]{64}$/.test(metadata.network?.devnetGenesisHash) ||
    !Number.isFinite(Date.parse(metadata.createdAt))
  )
    fail(
      "INVALID_BACKUP",
      "Backup metadata is not a supported LAVE descriptor-wallet backup.",
    );
}
export async function encryptBackup({ password, metadata, wallet, journal }) {
  validateBackupPassword(password);
  metadataValid(metadata);
  for (const file of [wallet, journal])
    if (!Buffer.isBuffer(file) || !file.length || file.length > MAX_FILE_BYTES)
      fail(
        "BACKUP_TOO_LARGE",
        "Backup file size is outside the supported bounds.",
      );
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const header = {
    ...metadata,
    cipher: "aes-256-gcm",
    kdf: KDF,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    files: {
      wallet: { size: wallet.length, sha256: sha256(wallet) },
      journal: { size: journal.length, sha256: sha256(journal) },
    },
  };
  const aad = Buffer.from(canonical(header));
  if (aad.length > MAX_HEADER_BYTES)
    fail("INVALID_BACKUP", "Backup metadata is too large.");
  const payload = Buffer.allocUnsafe(8 + wallet.length + journal.length);
  payload.writeUInt32BE(wallet.length, 0);
  payload.writeUInt32BE(journal.length, 4);
  wallet.copy(payload, 8);
  journal.copy(payload, 8 + wallet.length);
  const secret = passwordBytes(password);
  let key;
  try {
    key = await derive(secret, salt, 32, { ...KDF, maxmem: 64 * 1024 * 1024 });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(aad.length);
    return Buffer.concat([MAGIC, size, aad, ciphertext, cipher.getAuthTag()]);
  } finally {
    secret.fill(0);
    key?.fill(0);
    payload.fill(0);
  }
}

export async function decryptBackup({ password, bytes, role, network }) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 44 ||
    bytes.length > MAX_BACKUP_BYTES ||
    !bytes.subarray(0, 8).equals(MAGIC)
  )
    fail("INVALID_BACKUP", "Invalid or oversized backup file.");
  const headerLength = bytes.readUInt32BE(8);
  if (
    headerLength < 2 ||
    headerLength > MAX_HEADER_BYTES ||
    12 + headerLength + 16 >= bytes.length
  )
    fail("INVALID_BACKUP", "Invalid or truncated backup header.");
  const aad = bytes.subarray(12, 12 + headerLength);
  let header;
  try {
    header = JSON.parse(aad.toString("utf8"));
  } catch {
    fail("INVALID_BACKUP", "Invalid backup header.");
  }
  metadataValid(header);
  if (
    header.cipher !== "aes-256-gcm" ||
    canonical(header.kdf) !== canonical(KDF) ||
    !/^[0-9a-f]{32}$/.test(header.salt) ||
    !/^[0-9a-f]{24}$/.test(header.iv)
  )
    fail("INVALID_BACKUP", "Unsupported encryption parameters.");
  const secret = passwordBytes(password);
  let key, payload;
  try {
    key = await derive(secret, Buffer.from(header.salt, "hex"), 32, {
      ...KDF,
      maxmem: 64 * 1024 * 1024,
    });
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(header.iv, "hex"),
    );
    cipher.setAAD(aad);
    cipher.setAuthTag(bytes.subarray(-16));
    try {
      payload = Buffer.concat([
        cipher.update(bytes.subarray(12 + headerLength, -16)),
        cipher.final(),
      ]);
    } catch {
      fail(
        "BACKUP_AUTH_FAILED",
        "The password is incorrect or the backup is damaged.",
      );
    }
    if (
      header.role !== role ||
      canonical(header.network) !== canonical(network)
    )
      fail(
        "BACKUP_IDENTITY_MISMATCH",
        "Backup role or pinned blockchain does not match the selected recovery target.",
      );
    if (payload.length < 8) fail("INVALID_BACKUP", "Invalid backup payload.");
    const walletSize = payload.readUInt32BE(0),
      journalSize = payload.readUInt32BE(4);
    if (
      !walletSize ||
      !journalSize ||
      walletSize > MAX_FILE_BYTES ||
      journalSize > MAX_FILE_BYTES ||
      payload.length !== 8 + walletSize + journalSize
    )
      fail("INVALID_BACKUP", "Invalid backup file lengths.");
    const wallet = Buffer.from(payload.subarray(8, 8 + walletSize));
    const journal = Buffer.from(payload.subarray(8 + walletSize));
    for (const [name, file] of Object.entries({ wallet, journal }))
      if (
        header.files?.[name]?.size !== file.length ||
        header.files?.[name]?.sha256 !== sha256(file)
      ) {
        wallet.fill(0);
        journal.fill(0);
        fail("INVALID_BACKUP", "Backup file integrity check failed.");
      }
    return { metadata: header, wallet, journal };
  } finally {
    secret.fill(0);
    key?.fill(0);
    payload?.fill(0);
  }
}
