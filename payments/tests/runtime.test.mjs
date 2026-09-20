import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyLaveRuntime } from "../lab/runtime.mjs";

test("Native startup verifies the local-only manifest, exact executable digest and version before using LAVE Core", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lave-build-proof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "bin"));
  const daemonPath = join(dir, "bin/laved");
  const manifestPath = join(dir, "build.json");
  const bytes = "#!/bin/sh\nprintf 'LAVE Core daemon version local-test\\n'\n";
  const manifest = {
    format: 1,
    localDevelopmentOnly: true,
    binaries: {
      laved: {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        version: "LAVE Core daemon version local-test",
      },
    },
  };
  const verify = () => verifyLaveRuntime({ daemonPath });
  await assert.rejects(verify, /npm run core:build/);
  await writeFile(daemonPath, bytes, { mode: 0o700 });
  await assert.rejects(verify, /npm run core:build/);
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual(await verify(), manifest);
  for (const changed of [
    { ...manifest, format: 2 },
    { ...manifest, localDevelopmentOnly: false },
    {
      ...manifest,
      binaries: {
        laved: {
          ...manifest.binaries.laved,
          version: "Dash Core daemon version local-test",
        },
      },
    },
    {
      ...manifest,
      binaries: {
        laved: {
          ...manifest.binaries.laved,
          version: "LAVE Core daemon version wrong",
        },
      },
    },
    {
      ...manifest,
      binaries: {
        laved: { ...manifest.binaries.laved, sha256: "0".repeat(64) },
      },
    },
  ]) {
    await writeFile(manifestPath, JSON.stringify(changed));
    await assert.rejects(verify, /npm run core:build/);
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(daemonPath, bytes + "# changed after build\n");
  await assert.rejects(verify, /npm run core:build/);
});
