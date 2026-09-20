import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJson, readJson } from "./state.mjs";

test("signed transaction journal replacement persists exact bytes with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lave-seed-journal-"));
  try {
    const path = join(directory, "private", "state.json");
    const transaction = {
      txid: "1".repeat(64),
      raw: "00deadbeef",
      amount: "1000.10000000",
    };
    await writeJson(path, { pending: transaction });
    assert.deepEqual(await readJson(path), { pending: transaction });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, "private"))).mode & 0o777, 0o700);
    await writeJson(path, { pending: transaction, broadcast: true });
    assert.deepEqual(await readJson(path), {
      pending: transaction,
      broadcast: true,
    });
    assert.deepEqual(await readdir(join(directory, "private")), ["state.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
