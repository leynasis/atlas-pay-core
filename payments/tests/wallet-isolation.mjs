import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { DAEMON_PATH, VERSION } from "../network/config.mjs";
import { PROFILE, NETWORK_IDENTITY, RUNTIME_DIR } from "../lab/config.mjs";
import { assertLabNode, rpc } from "../lab/rpc.mjs";

// Creates a throwaway official Dash descriptor wallet. It never opens or changes
// any existing Atlas/regtest wallet and never publishes private wallet contents.
assert.equal(
  PROFILE,
  "lave",
  "Wallet isolation check requires LAVEPAY_NETWORK=lave.",
);
try {
  await access(DAEMON_PATH, constants.X_OK);
} catch {
  throw new Error(
    "The pinned official Dash runtime is needed as the independent source wallet. Run npm run network:install, then retry npm run test:wallet-isolation.",
  );
}
const { stdout: sourceVersion } = await promisify(execFile)(DAEMON_PATH, [
  "--version",
]);
assert.match(
  sourceVersion,
  new RegExp(`^Dash Core.*${VERSION.replaceAll(".", "\\.")}`),
);
await assertLabNode("customer");
const initialWallets = (await rpc("customer", "listwallets")).sort();
const initialInfo = await rpc("customer", "getwalletinfo", [], "customer");
assert.equal(initialInfo.descriptors, true);
const temporary = await mkdtemp(join(tmpdir(), "lave-wallet-isolation-"));
await chmod(temporary, 0o700);
const dataDir = join(temporary, "official-dash");
const configPath = join(temporary, "dash.conf");
const cookiePath = join(dataDir, "regtest", ".cookie");
const backupPath = join(temporary, "dash-descriptor.backup");
// Absolute wallet_name keeps even an unexpectedly successful restore confined
// to the test-owned temporary directory; existing customer wallets are untouched.
const restoredPath = join(temporary, "attempted-lave-restore");
let child;
let exited = false;
let spawnFailure;
let rpcPort;
let passed = false;
let failure;
let rejectionCode;
let sourceApplicationId;
let targetWalletReleased = false;

async function sourceRpc(method, params = [], wallet) {
  const cookie = (await readFile(cookiePath, "utf8")).trim();
  const suffix = wallet ? `/wallet/${encodeURIComponent(wallet)}` : "/";
  const response = await fetch(`http://127.0.0.1:${rpcPort}${suffix}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "wallet-isolation",
      method,
      params,
    }),
  });
  const result = await response.json();
  if (result.error)
    throw Object.assign(new Error(result.error.message), {
      code: result.error.code,
    });
  assert.equal(response.status, 200);
  return result.result;
}
async function waitForExit(milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!exited && Date.now() < deadline) await delay(100);
  return exited;
}
function interrupt() {
  failure ||= new Error("Wallet isolation check interrupted.");
  if (child && !exited) child.kill("SIGTERM");
}
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  await mkdir(dataDir, { mode: 0o700 });
  const reserve = createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  rpcPort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  await writeFile(
    configPath,
    [
      "regtest=1",
      "server=1",
      "networkactive=0",
      "listen=0",
      "dnsseed=0",
      "fixedseeds=0",
      "dns=0",
      "discover=0",
      "listenonion=0",
      "upnp=0",
      "natpmp=0",
      "dbcache=32",
      "par=1",
      "keypool=2",
      "printtoconsole=0",
      "[regtest]",
      `rpcport=${rpcPort}`,
      "rpcbind=127.0.0.1",
      "rpcallowip=127.0.0.1",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  child = spawn(DAEMON_PATH, [`-datadir=${dataDir}`, `-conf=${configPath}`], {
    stdio: "ignore",
  });
  child.once("error", (error) => {
    spawnFailure = error;
  });
  child.once("close", () => {
    exited = true;
  });
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (spawnFailure || exited)
      throw new Error("The temporary official Dash process could not start.");
    try {
      assert.equal((await sourceRpc("getblockchaininfo")).chain, "regtest");
      const network = await sourceRpc("getnetworkinfo");
      assert.equal(network.networkactive, false);
      assert.equal(network.connections, 0);
      ready = true;
      break;
    } catch (error) {
      if (
        error.code !== "ENOENT" &&
        error.cause?.code !== "ECONNREFUSED" &&
        error.code !== -28
      )
        throw error;
      await delay(100);
    }
  }
  assert.equal(
    ready,
    true,
    "Temporary official Dash RPC did not become ready.",
  );
  await sourceRpc("createwallet", [
    "source-descriptor",
    false,
    false,
    null,
    false,
    true,
    false,
  ]);
  assert.equal(
    (await sourceRpc("getwalletinfo", [], "source-descriptor")).descriptors,
    true,
  );
  await sourceRpc("backupwallet", [backupPath], "source-descriptor");
  await chmod(backupPath, 0o600);
  const handle = await open(backupPath, "r");
  try {
    const header = Buffer.alloc(100);
    assert.equal((await handle.read(header, 0, 100, 0)).bytesRead, 100);
    assert.equal(header.subarray(0, 16).toString(), "SQLite format 3\0");
    sourceApplicationId = header.readUInt32BE(68).toString(16).padStart(8, "0");
    assert.notEqual(sourceApplicationId, "fa4c56b9");
  } finally {
    await handle.close();
  }
  // Prove the exact backup is a valid descriptor wallet on its source chain;
  // a generic corrupt-file failure on LAVE would otherwise be a false positive.
  await sourceRpc("unloadwallet", ["source-descriptor", false]);
  await sourceRpc("restorewallet", ["source-backup-proof", backupPath, false]);
  assert.equal(
    (await sourceRpc("getwalletinfo", [], "source-backup-proof")).descriptors,
    true,
  );
  await assertLabNode("customer");
  await assert.rejects(
    rpc("customer", "restorewallet", [restoredPath, backupPath, false]),
    (error) => {
      rejectionCode = error.code;
      return (
        // IsSQLiteFile checks application_id before SQLiteDatabase::Verify;
        // the normal loader maps that early rejection to unrecognized format.
        (error.code === -18 &&
          /Wallet file verification failed\..*Data is not in recognized format\./.test(
            error.message,
          )) ||
        (error.code === -4 && /Unexpected application id/.test(error.message))
      );
    },
    "LAVE must reject the actual Dash descriptor backup by its database network identity.",
  );
  assert.deepEqual(
    (await rpc("customer", "listwallets")).sort(),
    initialWallets,
  );
  assert.equal(
    (await rpc("customer", "getwalletinfo", [], "customer")).walletname,
    initialInfo.walletname,
  );
  await assertLabNode("customer");
  passed = true;
} catch (error) {
  failure ||= error;
} finally {
  // If the tested guard regresses, unload only the test-owned restored wallet.
  try {
    if ((await rpc("customer", "listwallets")).includes(restoredPath))
      await rpc("customer", "unloadwallet", [restoredPath, false]);
    assert.equal(
      (await rpc("customer", "listwallets")).includes(restoredPath),
      false,
    );
    targetWalletReleased = true;
  } catch (error) {
    failure ||= new Error(
      "Could not verify cleanup of the test-owned restored wallet.",
      { cause: error },
    );
  }
  if (child && !exited) {
    try {
      await sourceRpc("stop");
    } catch {
      child.kill("SIGTERM");
    }
    if (!(await waitForExit(15000))) {
      child.kill("SIGTERM");
      if (!(await waitForExit(5000))) {
        child.kill("SIGKILL");
        if (!(await waitForExit(5000)))
          failure ||= new Error("Temporary Dash process did not stop.");
      }
    }
  }
  if ((!child || exited) && targetWalletReleased)
    await rm(temporary, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (failure) throw failure;
assert.equal(passed, true);
const report = {
  testedAt: new Date().toISOString(),
  network: NETWORK_IDENTITY,
  source: {
    version: sourceVersion.trim().split("\n")[0],
    chain: "regtest",
    descriptors: true,
    applicationId: sourceApplicationId,
    backupRestoredSuccessfullyOnSource: true,
  },
  targetApplicationId: "fa4c56b9",
  rejectedByDatabaseNetworkIdentity: true,
  rejectionCode,
  existingWalletsUnchanged: true,
  temporaryProcessStoppedAndFilesRemoved: true,
};
await mkdir(RUNTIME_DIR, { recursive: true, mode: 0o700 });
await writeFile(
  join(RUNTIME_DIR, "wallet-isolation-report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  "PASS Actual official Dash descriptor backup rejected by LAVE database network identity; existing wallets unchanged; temporary process and wallet files removed.",
);
