import assert from "node:assert/strict";
import { readFile, writeFile, symlink, link } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const { secret, writable, protectedPaths } = JSON.parse(process.argv[2]);
const denied = (e) => ["EPERM", "EACCES"].includes(e.code);
let checks = 0;
await writeFile(writable + "/invoices-test", "allowed");
assert.equal(await readFile(writable + "/invoices-test", "utf8"), "allowed");
checks++;
for (const path of [secret, ...protectedPaths]) {
  await assert.rejects(readFile(path), denied);
  checks++;
}
await assert.rejects(writeFile(secret, "overwrite"), denied);
checks++;
await symlink(secret, writable + "/link");
await assert.rejects(readFile(writable + "/link"), denied);
checks++;
try {
  await link(secret, writable + "/hardlink");
  await assert.rejects(readFile(writable + "/hardlink"), denied);
} catch (e) {
  assert(denied(e));
}
checks++;
const shell = spawnSync("/bin/cat", [secret], { encoding: "utf8" });
assert(shell.error && denied(shell.error));
checks++;
const child = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    'import fs from "node:fs";try{fs.readFileSync(' +
      JSON.stringify(secret) +
      ');process.exit(2)}catch(e){process.exit(["EPERM","EACCES"].includes(e.code)?0:3)}',
  ],
  { encoding: "utf8" },
);
assert.equal(child.status, 0, child.stderr);
checks++;
for (const port of [4174, 4175, 20101, 443]) {
  await assert.rejects(
    fetch("http://127.0.0.1:" + port, { signal: AbortSignal.timeout(2000) }),
    (e) => denied(e.cause || e),
  );
  checks++;
}
console.log(JSON.stringify({ checks, result: "passed" }));
