import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SignerError } from "../signer/policy.mjs";

const context = new AsyncLocalStorage();
const guarded = Symbol("walletGate");

// Deliberately do not steal stale locks: a crashed owner may have signed before
// persisting its result. A human must inspect that journal before removing it.
export async function withWalletGate(journalPath, operation) {
  const path = resolve(journalPath);
  if (context.getStore()?.get(path)?.active) return operation();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.mutation.lock`;
  let handle;
  const lease = { active: true };
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new SignerError(
        "WALLET_BUSY",
        "A wallet operation or backup is active. A lock left after a crash requires manual inspection.",
      );
    throw error;
  }
  try {
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        token: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
    await handle.sync();
    return await context.run(
      new Map([...(context.getStore() || []), [path, lease]]),
      operation,
    );
  } finally {
    lease.active = false;
    await handle.close();
    await unlink(lockPath);
  }
}

export function recoveryState(store) {
  const exists = store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='backup_recovery'",
    )
    .get();
  if (!exists) return null;
  const row = store.db
    .prepare("SELECT data FROM backup_recovery WHERE id=1")
    .get();
  return row ? JSON.parse(row.data) : null;
}

function requireRecoverySafe(signer, method, args) {
  if (!recoveryState(signer.store)) return;
  if (method === "prepare" && signer.store.get(args[0]?.id)) return;
  if (method === "approve") {
    const record = signer.store.get(args[0]);
    if (record?.rawHex && record?.txid) return;
  }
  if (method === "cancel") return;
  throw new SignerError(
    "RECOVERY_LOCKED",
    "Recovered backups cannot create new payments or signatures. Only previously saved signed transactions can be reconciled or retried; later activity may be missing from this snapshot.",
  );
}

function protect(target, methods, journalPath, check) {
  if (target[guarded]) return target;
  for (const method of methods) {
    const original = target[method].bind(target);
    target[method] = (...args) =>
      withWalletGate(journalPath, () => {
        check?.(method, args);
        return original(...args);
      });
  }
  Object.defineProperty(target, guarded, { value: true });
  return target;
}

export function protectSigner(signer, journalPath) {
  return protect(
    signer,
    ["prepare", "approve", "cancel"],
    journalPath,
    (method, args) => requireRecoverySafe(signer, method, args),
  );
}

export function protectWallet(service, journalPath) {
  return protect(
    service,
    ["status", "prepare", "approve", "cancel", "getRequest"],
    journalPath,
  );
}
