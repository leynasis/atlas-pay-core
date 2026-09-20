import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { cashierProfile, paymentsRoot } from "../isolation/profile.mjs";
import { NODES, SIGNER_DIR } from "../lab/config.mjs";

assert.equal(
  process.platform,
  "darwin",
  "This live confinement check requires macOS Seatbelt.",
);
const fixture = await mkdtemp(join(paymentsRoot, ".runtime/isolation-check-"));
const writable = join(fixture, "cashier");
await mkdir(writable);
const secret = join(fixture, "private-wallet.dat");
await writeFile(secret, "synthetic secret; never a real wallet", {
  mode: 0o600,
});
try {
  const profile = cashierProfile({ data: await realpath(writable) });
  const spec = {
    secret,
    writable,
    protectedPaths: [
      NODES.customer.cookiePath,
      NODES.signer?.cookiePath || NODES.merchant.cookiePath,
      join(SIGNER_DIR, "customer.sqlite"),
    ],
  };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        profile,
        process.execPath,
        "isolation/probe.mjs",
        JSON.stringify(spec),
      ],
      {
        cwd: paymentsRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH },
      },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (part) => (out += part));
    child.stderr.on("data", (part) => (err += part));
    child.once("error", reject);
    child.once("exit", (status, signal) =>
      status === 0
        ? resolve(JSON.parse(out))
        : reject(
            new Error(
              "Confinement probe failed (" + (signal || status) + "): " + err,
            ),
          ),
    );
  });
  assert.equal(
    await readFile(secret, "utf8"),
    "synthetic secret; never a real wallet",
  );
  const report = {
    ...result,
    checkedAt: new Date().toISOString(),
    mode: "macos-seatbelt",
    scope:
      "Cashier file access, writes, symlinks, hardlinks, subprocess inheritance and wallet/network restrictions.",
  };
  await writeFile(
    join(paymentsRoot, ".runtime/isolation-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Cashier OS confinement: " + result.checks + " live checks passed.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
