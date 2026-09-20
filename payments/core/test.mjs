import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, availableParallelism, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runtime = join(root, "payments", ".runtime", "lave-core");
const buildSource = join(runtime, "build", "src");
const binary = join(buildSource, "test", "test_dash");
const lock = join(runtime, "build.lock");
const jobs = Number(
  process.env.LAVE_BUILD_JOBS || Math.min(4, availableParallelism()),
);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32)
  throw new Error("LAVE_BUILD_JOBS must be an integer from 1 to 32.");
const env = { ...process.env, LC_ALL: "C" };
const suites = [
  "lave_params_tests,amount_tests,pow_tests,versionbits_tests",
  "util_tests/message_sign",
  "util_tests/message_verify",
  "util_tests/message_hash",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sourceDigest() {
  // Keep this input set identical to core/build.mjs: compare source content,
  // including uncommitted native edits, rather than trusting a Git revision.
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
      "build-aux",
      "share/genbuild.sh",
      "configure.ac",
      "Makefile.am",
      "autogen.sh",
    ],
    { cwd: root, env, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths)
    hash
      .update(path)
      .update("\0")
      .update(await readFile(join(root, path)))
      .update("\0");
  return hash.digest("hex");
}

function run(command, args) {
  console.log(`\n${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${signal || code})`)),
    );
  });
}

let manifest;
try {
  manifest = JSON.parse(await readFile(join(runtime, "build.json"), "utf8"));
  await readFile(join(buildSource, "Makefile"));
} catch (error) {
  throw new Error(
    "A completed source build is required. Run npm run core:build first.",
    { cause: error },
  );
}
assert.equal(manifest.format, 1, "Unsupported build manifest");
assert.equal(manifest.localDevelopmentOnly, true);
assert.equal(manifest.platform, platform());
assert.equal(manifest.arch, arch());
for (const name of ["laved", "lave-cli"])
  assert.equal(
    digest(await readFile(join(runtime, "bin", name))),
    manifest.binaries[name].sha256,
    `Installed ${name} differs from its source-build manifest`,
  );
assert.equal(
  await sourceDigest(),
  manifest.nativeSourceSha256,
  "Native sources changed. Run npm run core:build before testing.",
);
try {
  await mkdir(lock);
} catch (error) {
  if (error.code === "EEXIST")
    throw new Error(
      "A native build or test build may be running. Wait for it to finish before core:test.",
    );
  throw error;
}
try {
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      operation: "core:test",
      startedAt: new Date().toISOString(),
    }),
  );
  await rm(join(runtime, "native-test-report.json"), { force: true });
  await run("make", ["-C", buildSource, `-j${jobs}`, "test/test_dash"]);
  for (const suite of suites)
    await run(binary, [`--run_test=${suite}`, "--report_level=short"]);
  assert.equal(
    await sourceDigest(),
    manifest.nativeSourceSha256,
    "Native sources changed during testing; these results cannot validate the installed build.",
  );
  await writeFile(
    join(runtime, "native-test-report.json"),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", nativeSourceSha256: manifest.nativeSourceSha256, testBinarySha256: digest(await readFile(binary)), suites, scope: "Selected native unit suites; no public network or functional-regtest run." }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    "LAVE native suites passed: pinned chain identity, address/key isolation, network guards, amounts, PoW, versionbits and signed-message domain.",
  );
} finally {
  await rm(lock, { recursive: true, force: true });
}
