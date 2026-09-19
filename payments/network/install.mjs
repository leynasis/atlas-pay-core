import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  DAEMON_PATH,
  RELEASES,
  RELEASE_URL,
  RUNTIME_DIR,
  VERSION,
} from "./config.mjs";

const exec = promisify(execFile);
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MANIFEST_SHA256 =
  "0658c6985af3d79a3fec82bcf4692e5e74cbb2bfd776c9180a8dab55134a5d26";

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error(`Download failed: HTTP ${response.status} at ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function install() {
  const release = RELEASES[`${process.platform}-${process.arch}`];
  if (!release)
    throw new Error(
      `No pinned release for ${process.platform}-${process.arch}. Use macOS/Linux ARM64 or x64.`,
    );
  const [target, expected] = release;
  const archiveName = `dashcore-${VERSION}-${target}.tar.gz`;
  await mkdir(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  const marker = join(RUNTIME_DIR, "installation.json");
  try {
    const installed = JSON.parse(await readFile(marker, "utf8"));
    await access(DAEMON_PATH);
    if (installed.archive === archiveName && installed.sha256 === expected)
      return installed;
  } catch {
    /* First installation or incomplete previous attempt. */
  }

  const manifest = await download(`${RELEASE_URL}/SHA256SUMS.asc`);
  if (checksum(manifest) !== MANIFEST_SHA256)
    throw new Error(
      "Official release checksum manifest differs from the pinned copy.",
    );
  const lines = manifest.toString("utf8").split(/\r?\n/);
  if (!lines.includes(`${expected}  ${archiveName}`))
    throw new Error("Archive checksum is missing from the official manifest.");
  console.log(`Downloading official Dash Core ${VERSION} (${target})…`);
  const archive = await download(`${RELEASE_URL}/${archiveName}`);
  if (checksum(archive) !== expected)
    throw new Error(
      "Archive SHA256 verification failed; nothing was extracted.",
    );
  const archivePath = join(RUNTIME_DIR, archiveName);
  await writeFile(`${archivePath}.part`, archive, { mode: 0o600 });
  await rename(`${archivePath}.part`, archivePath);
  await writeFile(join(RUNTIME_DIR, "SHA256SUMS.asc"), manifest, {
    mode: 0o600,
  });
  await exec("tar", [
    "-xzf",
    archivePath,
    "-C",
    RUNTIME_DIR,
    `dashcore-${VERSION}/bin/dashd`,
    `dashcore-${VERSION}/bin/dash-cli`,
  ]);
  // Upstream tar archives contain unsigned Mach-O executables. Apple Silicon
  // requires a signature to execute them. This is local ad-hoc signing, not
  // an upstream identity signature, and changes no system security settings.
  const localAdHocSigning =
    process.platform === "darwin" && process.arch === "arm64";
  if (localAdHocSigning) {
    for (const executable of ["dashd", "dash-cli"]) {
      await exec("codesign", [
        "--force",
        "--sign",
        "-",
        join(RUNTIME_DIR, `dashcore-${VERSION}`, "bin", executable),
      ]);
    }
  }
  const { stdout } = await exec(DAEMON_PATH, ["-version"]);
  if (!stdout.includes(`v${VERSION}`))
    throw new Error(
      "Extracted daemon version does not match the pinned release.",
    );
  const installed = {
    version: VERSION,
    archive: archiveName,
    sha256: expected,
    source: `${RELEASE_URL}/${archiveName}`,
    verification:
      "Pinned SHA256; OpenPGP signatures retained, not independently verified",
    localAdHocSigning,
    installedAt: new Date().toISOString(),
  };
  await writeFile(marker, `${JSON.stringify(installed, null, 2)}\n`, {
    mode: 0o600,
  });
  await rm(archivePath);
  console.log("Official binary installed and SHA256 verified.");
  return installed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  install()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
