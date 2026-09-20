import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createWalletServer } from "../wallet/http.mjs";
import { SignerStore } from "../signer/store.mjs";
import { networkProfile, profileIdentity } from "../lab/profiles.mjs";
import { decryptBackup } from "../backup/crypto.mjs";

test("wallet backup HTTP requires exact Origin, session and CSRF; rejects extra fields and exports authenticated binary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lave-backup-http-"));
  const journalPath = join(directory, "journal.sqlite"),
    walletPath = join(directory, "fixture.sqlite");
  const wallet = new DatabaseSync(walletPath);
  wallet.exec(
    `PRAGMA application_id=${0xfa4c56b9 | 0}; CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES('private-test-wallet')`,
  );
  wallet.close();
  const walletBytes = await readFile(walletPath);
  const store = new SignerStore(journalPath);
  const network = profileIdentity(networkProfile("lave"));
  let backups = 0;
  const signer = {
    role: "customer",
    identity: network,
    checkNetwork: async () => ({
      blocks: 1,
      bestblockhash: network.devnetGenesisHash,
    }),
    rpc: async (_role, method, params) => {
      if (method === "getwalletinfo")
        return {
          descriptors: true,
          private_keys_enabled: true,
          scanning: false,
          txcount: 0,
        };
      if (method === "backupwallet") {
        backups++;
        await writeFile(params[0], walletBytes, { mode: 0o600 });
        return null;
      }
      throw new Error(`Unexpected fixture RPC method: ${method}`);
    },
  };
  const service = {
    signer,
    store,
    status: async () => ({
      role: "customer",
      network,
      currency: "LAVE",
      chainAvailable: true,
    }),
  };
  const server = createWalletServer({ service, role: "customer", journalPath });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const password = "throwaway-http-backup-test";
  try {
    const status = await fetch(`${origin}/api/wallet/status`);
    const cookie = status.headers.get("set-cookie").split(";")[0];
    const csrfToken = (await status.json()).csrfToken;
    const post = (headers = {}, body = { password }) =>
      fetch(`${origin}/api/wallet/backup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": csrfToken,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    for (const [headers, code] of [
      [{ Cookie: "" }, "SESSION_REQUIRED"],
      [{ "X-CSRF-Token": "0".repeat(64) }, "INVALID_CSRF"],
      [{ Origin: "http://127.0.0.1:9999" }, "INVALID_ORIGIN"],
      [{ Origin: "" }, "INVALID_ORIGIN"],
      [{ "Sec-Fetch-Site": "cross-site" }, "INVALID_ORIGIN"],
    ]) {
      const response = await post(headers);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, code);
    }
    const extra = await post({}, { password, path: "/untrusted/location" });
    assert.equal(extra.status, 409);
    assert.equal((await extra.json()).error.code, "INVALID_INPUT");
    assert.equal(backups, 0);
    const success = await post();
    assert.equal(success.status, 200);
    assert.equal(
      success.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal(success.headers.get("cache-control"), "no-store");
    assert.equal(success.headers.get("x-frame-options"), "DENY");
    assert.match(
      success.headers.get("content-disposition"),
      /^attachment; filename="lave-customer-.*\.lavebackup"$/,
    );
    const bytes = Buffer.from(await success.arrayBuffer());
    assert.equal(bytes.includes(Buffer.from(password)), false);
    assert.equal(bytes.includes(walletBytes), false);
    const decoded = await decryptBackup({
      bytes,
      password,
      role: "customer",
      network,
    });
    assert.deepEqual(decoded.wallet, walletBytes);
    assert.equal(backups, 1);
    const get = await fetch(`${origin}/api/wallet/backup`);
    assert.equal(get.status, 404);
  } finally {
    server.close();
    await once(server, "close");
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
