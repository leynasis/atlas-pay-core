import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { availableParallelism, arch, platform } from "node:os";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runtime = join(root, "payments", ".runtime", "lave-core");
const build = join(runtime, "build");
const bin = join(runtime, "bin");
const lock = join(runtime, "build.lock");
const jobs = Number(
  process.env.LAVE_BUILD_JOBS || Math.min(4, availableParallelism()),
);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) {
  throw new Error("LAVE_BUILD_JOBS must be an integer from 1 to 32.");
}
const env = {
  ...process.env,
  LC_ALL: "C",
  CXXFLAGS: process.env.CXXFLAGS || "-O1 -g0",
  CFLAGS: process.env.CFLAGS || "-O1 -g0",
};
const configureArgs = [
  "--with-gui=no",
  "--without-bdb",
  "--with-sqlite=yes",
  "--disable-zmq",
  "--without-miniupnpc",
  "--without-natpmp",
  "--disable-bench",
  "--disable-shared",
  "--disable-man",
  "--enable-tests",
  "--without-libs",
  "--disable-stacktraces",
];
if (process.env.LAVE_BOOST_PREFIX)
  configureArgs.push(`--with-boost=${process.env.LAVE_BOOST_PREFIX}`);

function capture(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
  }).trim();
}
function run(command, args, cwd) {
  console.log(`\n${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${signal || code})`)),
    );
  });
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sourceDigest() {
  const paths = capture("git", [
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
  ])
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

await mkdir(runtime, { recursive: true, mode: 0o700 });
try {
  await mkdir(lock);
} catch (error) {
  if (error.code === "EEXIST")
    throw new Error(
      `Another build may be active. Inspect ${lock} before removing a stale lock.`,
    );
  throw error;
}
try {
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );
  await mkdir(build, { recursive: true });
  await mkdir(bin, { recursive: true });
  const before = await sourceDigest();
  // The vendored RELIC configure step rewrites this generated header even when
  // its contents do not change. Preserve its timestamp in that case so an
  // incremental build does not unnecessarily recompile every Core object.
  const relicHeader = join(
    build,
    "src/dashbls/depends/relic/include/relic_conf.h",
  );
  let previousHeader;
  try {
    previousHeader = {
      bytes: await readFile(relicHeader),
      info: await stat(relicHeader),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await run("sh", ["./autogen.sh"], root);
  await run(join(root, "configure"), configureArgs, build);
  if (
    previousHeader &&
    previousHeader.bytes.equals(await readFile(relicHeader))
  )
    await utimes(
      relicHeader,
      previousHeader.info.atime,
      previousHeader.info.mtime,
    );
  await run("make", [`-j${jobs}`, "-C", "src", "dashd", "dash-cli"], build);
  const after = await sourceDigest();
  if (before !== after)
    throw new Error(
      "Native sources changed during compilation. Run core:build again before installing binaries.",
    );
  const binaries = {};
  for (const [built, installed] of [
    ["dashd", "laved"],
    ["dash-cli", "lave-cli"],
  ]) {
    const temporary = join(bin, `${installed}.next`);
    await copyFile(join(build, "src", built), temporary);
    await chmod(temporary, 0o755);
    const version = capture(temporary, ["--version"]);
    if (!version.startsWith("LAVE Core"))
      throw new Error(`${built} did not identify itself as LAVE Core.`);
    binaries[installed] = {
      sha256: digest(await readFile(temporary)),
      version: version.split("\n")[0],
    };
  }
  const manifest = {
    format: 1,
    builtAt: new Date().toISOString(),
    platform: platform(),
    arch: arch(),
    upstream: {
      tag: "v23.1.8",
      commit: "728f5055836c6d29806412fc7223ac8fe05af991",
    },
    checkoutCommit: capture("git", ["rev-parse", "HEAD"]),
    nativeSourceSha256: after,
    configureArgs,
    cxxflags: env.CXXFLAGS,
    cflags: env.CFLAGS,
    compiler: capture(process.env.CXX || "c++", ["--version"]).split("\n")[0],
    dependencies: capture("pkg-config", [
      "--modversion",
      "libevent",
      "sqlite3",
      "gmp",
    ]).split("\n"),
    binaries,
    localDevelopmentOnly: true,
  };
  await writeFile(
    join(runtime, "build.json.next"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  // Validate both staged binaries and prepare provenance before replacing either
  // active file. Startup verifies the manifest hash, so an interrupted install
  // fails closed until this command completes successfully.
  for (const installed of Object.keys(binaries))
    await rename(join(bin, `${installed}.next`), join(bin, installed));
  await rename(join(runtime, "build.json.next"), join(runtime, "build.json"));
  console.log(
    `\nLAVE Core installed in ${bin}. Build provenance: ${join(runtime, "build.json")}`,
  );
} finally {
  await rm(lock, { recursive: true, force: true });
}
