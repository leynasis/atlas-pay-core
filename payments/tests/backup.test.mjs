import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { networkProfile, profileIdentity } from "../lab/profiles.mjs";
import { requestDigest } from "../signer/policy.mjs";
import { SignerStore } from "../signer/store.mjs";
import {
  encryptBackup,
  decryptBackup,
  MAX_BACKUP_BYTES,
} from "../backup/crypto.mjs";
import {
  withWalletGate,
  protectSigner,
  recoveryState,
} from "../backup/gate.mjs";
import {
  restoreWalletBackup,
  validateJournal,
  createWalletBackup,
} from "../backup/service.mjs";

const network = profileIdentity(networkProfile("lave"));
const password = "throwaway-test-password-only";
const metadata = {
  version: 1,
  profile: "lave",
  role: "customer",
  network,
  createdAt: new Date().toISOString(),
};
const fixture = {
  wallet: Buffer.from("wallet private fixture"),
  journal: Buffer.from("signing journal fixture"),
};
function record(state = "broadcast_unknown") {
  const request = {
    id: randomUUID(),
    network,
    amount: "0.01",
    amountSats: "1000000",
  };
  request.requestHash = requestDigest(request);
  return {
    id: request.id,
    request,
    state,
    ...(["broadcast", "signed", "broadcast_unknown"].includes(state)
      ? { rawHex: "abcd", txid: "a".repeat(64) }
      : {}),
  };
}
async function temporary(fn) {
  const path = await mkdtemp(join(tmpdir(), "lave-backup-test-"));
  try {
    return await fn(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test("authenticated encryption round-trips, uses fresh salt/nonce and rejects wrong password, corruption and truncation", async () => {
  const one = await encryptBackup({ password, metadata, ...fixture });
  const two = await encryptBackup({ password, metadata, ...fixture });
  assert.notDeepEqual(one, two);
  assert.equal(one.includes(fixture.wallet), false);
  const result = await decryptBackup({
    password,
    bytes: one,
    role: "customer",
    network,
  });
  assert.deepEqual(result.wallet, fixture.wallet);
  assert.deepEqual(result.journal, fixture.journal);
  await assert.rejects(
    decryptBackup({
      password: "another-test-password",
      bytes: one,
      role: "customer",
      network,
    }),
    { code: "BACKUP_AUTH_FAILED" },
  );
  const corrupt = Buffer.from(one);
  corrupt[corrupt.length - 20] ^= 1;
  await assert.rejects(
    decryptBackup({ password, bytes: corrupt, role: "customer", network }),
    { code: "BACKUP_AUTH_FAILED" },
  );
  await assert.rejects(
    decryptBackup({
      password,
      bytes: one.subarray(0, -3),
      role: "customer",
      network,
    }),
    { code: "BACKUP_AUTH_FAILED" },
  );
});

test("metadata is authenticated and KDF parameters, size, role and network are bounded", async () => {
  const bytes = await encryptBackup({ password, metadata, ...fixture });
  const changed = Buffer.from(bytes);
  const offset = changed.indexOf(Buffer.from('"role":"customer"'));
  Buffer.from('"role":"merchant"').copy(changed, offset);
  await assert.rejects(
    decryptBackup({ password, bytes: changed, role: "merchant", network }),
    { code: "BACKUP_AUTH_FAILED" },
  );
  const parameters = Buffer.from(bytes);
  const n = parameters.indexOf(Buffer.from('"N":32768'));
  Buffer.from('"N":99999').copy(parameters, n);
  await assert.rejects(
    decryptBackup({ password, bytes: parameters, role: "customer", network }),
    { code: "INVALID_BACKUP" },
  );
  await assert.rejects(
    decryptBackup({ password, bytes, role: "merchant", network }),
    { code: "BACKUP_IDENTITY_MISMATCH" },
  );
  await assert.rejects(
    decryptBackup({
      password,
      bytes,
      role: "customer",
      network: profileIdentity(networkProfile("atlas")),
    }),
    { code: "BACKUP_IDENTITY_MISMATCH" },
  );
  await assert.rejects(
    decryptBackup({
      password,
      bytes: Buffer.alloc(MAX_BACKUP_BYTES + 1),
      role: "customer",
      network,
    }),
    { code: "INVALID_BACKUP" },
  );
  await assert.rejects(
    encryptBackup({ password: "short", metadata, ...fixture }),
    { code: "INVALID_BACKUP_PASSWORD" },
  );
});

test("wallet gate excludes concurrent operations but permits nested wrappers and releases after failure", () =>
  temporary(async (path) => {
    const journalPath = join(path, "journal.sqlite");
    let release, entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const blocker = new Promise((resolve) => {
      release = resolve;
    });
    const operation = withWalletGate(journalPath, async () => {
      await withWalletGate(journalPath, async () => {});
      entered();
      await blocker;
    });
    await ready;
    await assert.rejects(
      withWalletGate(journalPath, async () => {}),
      { code: "WALLET_BUSY" },
    );
    release();
    await operation;
    await assert.rejects(
      withWalletGate(journalPath, async () => {
        throw new Error("fixture");
      }),
      /fixture/,
    );
    await withWalletGate(journalPath, async () => {});
    let detached;
    await withWalletGate(journalPath, async () => {
      detached = AsyncResource.bind(() =>
        withWalletGate(journalPath, async () => {}),
      );
    });
    await withWalletGate(journalPath, async () => {
      await assert.rejects(detached(), { code: "WALLET_BUSY" });
    });
  }));

test("backup rejects ambiguous journal states before Core backupwallet", () =>
  temporary(async (path) => {
    const journalPath = join(path, "journal.sqlite"),
      store = new SignerStore(journalPath);
    try {
      const item = record("signing");
      store.create(item);
      const calls = [];
      const signer = {
        role: "customer",
        identity: network,
        checkNetwork: async () => ({
          blocks: 1,
          bestblockhash: network.devnetGenesisHash,
        }),
        rpc: async (_role, method) => {
          calls.push(method);
          return {
            descriptors: true,
            private_keys_enabled: true,
            scanning: false,
            txcount: 0,
          };
        },
      };
      await assert.rejects(
        createWalletBackup({ signer, store, journalPath, password }),
        { code: "BACKUP_STATE_UNCERTAIN" },
      );
      assert.deepEqual(calls, ["getwalletinfo"]);
      for (const state of [
        "preparing",
        "preparation_uncertain",
        "awaiting_approval",
        "broadcasting",
        "cancelling",
      ]) {
        item.state = state;
        store.put(item);
        assert.throws(() => validateJournal(store.db, network), {
          code: "BACKUP_STATE_UNCERTAIN",
        });
      }
    } finally {
      store.close();
    }
  }));

test("fresh-directory restore preserves signed bytes and metadata, refuses overwrite and locks fresh signing", () =>
  temporary(async (path) => {
    const sourcePath = join(path, "source.sqlite"),
      store = new SignerStore(sourcePath);
    const saved = record();
    store.create(saved);
    store.db.exec(
      "CREATE TABLE wallet_imports(invoice_id TEXT,kind TEXT,request_id TEXT,receipt_key TEXT,receipt_state TEXT); CREATE TABLE wallet_settings(key TEXT,value TEXT);",
    );
    store.db
      .prepare("INSERT INTO wallet_imports VALUES(?,?,?,?,?)")
      .run(saved.id, "payment", saved.id, randomUUID(), "pending");
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    store.close();
    const walletPath = join(path, "wallet.sqlite"),
      walletDb = new DatabaseSync(walletPath);
    walletDb.exec(
      `PRAGMA application_id=${0xfa4c56b9 | 0}; CREATE TABLE fixture(id INTEGER)`,
    );
    walletDb.close();
    const bytes = await encryptBackup({
      password,
      metadata,
      wallet: await readFile(walletPath),
      journal: await readFile(sourcePath),
    });
    const directory = join(path, "restored");
    const result = await restoreWalletBackup({
      bytes,
      password,
      directory,
      role: "customer",
      network,
    });
    assert.equal(result.recoveryLocked, true);
    const foreignWallet = Buffer.from(await readFile(walletPath));
    foreignWallet.writeUInt32BE(0xe2caffce, 68);
    const mislabeled = await encryptBackup({
      password,
      metadata,
      wallet: foreignWallet,
      journal: await readFile(sourcePath),
    });
    await assert.rejects(
      restoreWalletBackup({
        bytes: mislabeled,
        password,
        directory: join(path, "foreign"),
        role: "customer",
        network,
      }),
      { code: "BACKUP_IDENTITY_MISMATCH" },
    );
    await assert.rejects(access(join(path, "foreign")), { code: "ENOENT" });
    const recovered = new SignerStore(result.journalPath);
    try {
      assert.deepEqual(recovered.get(saved.id), saved);
      assert.equal(
        recovered.db.prepare("SELECT COUNT(*) n FROM wallet_imports").get().n,
        1,
      );
      assert.equal(recoveryState(recovered).policy, "saved-transactions-only");
      let approvals = 0;
      const signer = protectSigner(
        {
          store: recovered,
          prepare: async (request) => request.id,
          approve: async (id) => {
            approvals++;
            return id;
          },
          cancel: async (id) => id,
        },
        result.journalPath,
      );
      assert.equal(await signer.prepare(saved.request), saved.id);
      assert.equal(await signer.approve(saved.id), saved.id);
      assert.equal(approvals, 1);
      await assert.rejects(signer.prepare({ id: randomUUID() }), {
        code: "RECOVERY_LOCKED",
      });
      const unsigned = record("prepared");
      recovered.create(unsigned);
      await assert.rejects(signer.approve(unsigned.id), {
        code: "RECOVERY_LOCKED",
      });
    } finally {
      recovered.close();
    }
    await assert.rejects(
      restoreWalletBackup({
        bytes,
        password,
        directory,
        role: "customer",
        network,
      }),
      { code: "RECOVERY_TARGET_EXISTS" },
    );
    await assert.rejects(
      restoreWalletBackup({
        bytes,
        password: "incorrect-test-password",
        directory: join(path, "wrong"),
        role: "customer",
        network,
      }),
      { code: "BACKUP_AUTH_FAILED" },
    );
    await assert.rejects(access(join(path, "wrong")), { code: "ENOENT" });
  }));
