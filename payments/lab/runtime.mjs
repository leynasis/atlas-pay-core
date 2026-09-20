import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { LAB_DAEMON_PATH } from "./config.mjs";

const exec = promisify(execFile);

export async function verifyLaveRuntime({
  daemonPath = LAB_DAEMON_PATH,
  manifestPath = join(dirname(dirname(daemonPath)), "build.json"),
} = {}) {
  try {
    await access(daemonPath, constants.X_OK);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const binary = manifest.binaries?.laved;
    if (
      manifest.format !== 1 ||
      manifest.localDevelopmentOnly !== true ||
      typeof binary?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(binary.sha256) ||
      typeof binary.version !== "string" ||
      !/^LAVE Core\b[^\r\n]*$/.test(binary.version)
    )
      throw new Error("Invalid LAVE Core build manifest.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(daemonPath)) hash.update(chunk);
    if (hash.digest("hex") !== binary.sha256)
      throw new Error(
        "LAVE Core executable does not match its build manifest.",
      );
    const { stdout } = await exec(daemonPath, ["--version"], {
      timeout: 10000,
    });
    if (stdout.trim().split("\n")[0] !== binary.version)
      throw new Error(
        "LAVE Core executable version does not match its build manifest.",
      );
    return manifest;
  } catch (cause) {
    throw new Error(
      "LAVE Core is missing or its source-build manifest could not be verified. Run npm run core:build from payments, then retry npm run lab:start. The LAVE profile never downloads or substitutes Dash Core.",
      { cause },
    );
  }
}
