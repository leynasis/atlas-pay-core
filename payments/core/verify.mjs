import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PROFILE,
  NODE_IDS,
  NODES,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  LAB_DIR,
} from "../lab/config.mjs";
import { inspectNode, rpc } from "../lab/rpc.mjs";

const execute = promisify(execFile);
const runtime = fileURLToPath(
  new URL("../.runtime/lave-core/", import.meta.url),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest();
assert.equal(PROFILE, "lave", "core:verify requires the LAVE profile");
const manifest = JSON.parse(
  await readFile(join(runtime, "build.json"), "utf8"),
);
let checks = 0;
for (const name of ["laved", "lave-cli"]) {
  const binary = join(runtime, "bin", name);
  assert.equal(
    sha(await readFile(binary)).toString("hex"),
    manifest.binaries[name].sha256,
  );
  const version = await execute(binary, ["--version"]);
  assert.match(version.stdout, /^LAVE Core/);
  const datadir = await mkdtemp(join(tmpdir(), "lave-guard-"));
  try {
    for (const flags of [
      [],
      ["-testnet"],
      ["-regtest"],
      ["-chain=main"],
      ["-devnet=atlas-local-v1"],
      ["-devnet=lave-local-v1", "-regtest"],
    ]) {
      let rejected;
      try {
        await execute(
          binary,
          [
            `-datadir=${datadir}`,
            ...flags,
            ...(name === "lave-cli" ? ["getblockchaininfo"] : []),
          ],
          { timeout: 15000 },
        );
      } catch (error) {
        rejected = error;
      }
      assert.ok(
        rejected &&
          !rejected.killed &&
          Number.isInteger(rejected.code) &&
          rejected.code !== 0,
        `${name} must promptly reject ${flags.join(" ") || "missing network"}: ${JSON.stringify({ code: rejected?.code, signal: rejected?.signal, killed: rejected?.killed, error: rejected?.stderr })}`,
      );
      assert.match(
        `${rejected.stdout}${rejected.stderr}`,
        /LAVE Core is a local development build|Invalid combination|Only one of/,
      );
      checks++;
    }
    await writeFile(join(datadir, "lave.conf"), "testnet=1\n");
    await assert.rejects(
      execute(
        binary,
        [
          `-datadir=${datadir}`,
          ...(name === "lave-cli" ? ["getblockchaininfo"] : []),
        ],
        { timeout: 15000 },
      ),
      (error) =>
        !error.killed &&
        /LAVE Core is a local development build/.test(error.stderr),
    );
    checks++;
  } finally {
    await rm(datadir, { recursive: true, force: true });
  }
}

// Valid Base58Check Dash addresses with a fixed public hash, no private keys.
function address(prefix) {
  const payload = Buffer.concat([Buffer.from([prefix]), Buffer.alloc(20, 1)]);
  const data = Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${data.toString("hex")}`),
    encoded = "";
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return encoded;
}
for (const node of NODE_IDS) {
  const state = await inspectNode(node);
  assert.equal(state.genesisHash, GENESIS_HASH);
  assert.equal(state.devnetGenesisHash, DEVNET_GENESIS_HASH);
  assert.match(state.network.subversion, /LAVE/);
  const wallet = await rpc(node, "getwalletinfo", [], NODES[node].wallet);
  assert.equal(wallet.descriptors, true);
  assert.equal(wallet.private_keys_enabled, node !== "merchant");
  const received = await rpc(
    node,
    node === "signer" ? "getrawchangeaddress" : "getnewaddress",
    node === "signer" ? [] : ["core-verification"],
    NODES[node].wallet,
  );
  assert.match(received, /^L/);
  for (const prefix of [76, 16, 140, 19]) {
    assert.equal(
      (await rpc(node, "validateaddress", [address(prefix)])).isvalid,
      false,
      `Dash prefix ${prefix} must be rejected by ${node}`,
    );
  }
  checks++;
}
const report = {
  checkedAt: new Date().toISOString(),
  checks,
  genesisHash: GENESIS_HASH,
  devnetGenesisHash: DEVNET_GENESIS_HASH,
  nativeSourceSha256: manifest.nativeSourceSha256,
  result: "passed",
};
await writeFile(
  join(LAB_DIR, "core-verification.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(
  `LAVE Core: ${checks} checks passed (binary hashes, network guards, isolated genesis, LAVE addresses, descriptor wallets).`,
);
