import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  CONF_PATH,
  DAEMON_PATH,
  DATA_DIR,
  RPC_PORT,
  P2P_PORT,
  RUNTIME_DIR,
  WALLETS,
} from "./config.mjs";
import { install } from "./install.mjs";
import { assertRegtest, rpc } from "./rpc.mjs";

const exec = promisify(execFile);

async function ensureWallet(name) {
  if ((await rpc("listwallets")).includes(name)) return;
  const known = (await rpc("listwalletdir")).wallets.some(
    (wallet) => wallet.name === name,
  );
  if (known) await rpc("loadwallet", [name]);
  else await rpc("createwallet", [name]);
}

export async function start() {
  await install();
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const conf = [
    "# Generated for an isolated, local-only payment prototype.",
    "regtest=1",
    "server=1",
    "networkactive=0",
    "dnsseed=0",
    "discover=0",
    "listenonion=0",
    "upnp=0",
    "natpmp=0",
    "fallbackfee=0.00001",
    "[regtest]",
    "connect=0",
    `rpcport=${RPC_PORT}`,
    "rpcbind=127.0.0.1",
    "rpcallowip=127.0.0.1",
    `port=${P2P_PORT}`,
    "bind=127.0.0.1",
    "",
  ].join("\n");
  let running = false;
  try {
    await rpc("getblockchaininfo");
    running = true;
  } catch (error) {
    if (error.code === -28)
      running = true; // Existing daemon still warming up.
    else if (error.message.includes("authentication failed")) throw error;
  }
  if (!running) {
    await writeFile(CONF_PATH, conf, { mode: 0o600 });
    const { stdout } = await exec(
      DAEMON_PATH,
      [
        `-datadir=${DATA_DIR}`,
        `-conf=${CONF_PATH}`,
        "-regtest=1",
        "-daemonwait=1",
      ],
      { timeout: 60000 },
    );
    if (stdout.trim()) console.log(stdout.trim());
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await assertRegtest();
      ready = true;
      break;
    } catch (error) {
      if (error.message.startsWith("Refusing")) throw error;
      await delay(500);
    }
  }
  if (!ready)
    throw new Error(
      `Daemon did not become ready. Inspect ${DATA_DIR}/regtest/debug.log.`,
    );
  for (const name of Object.values(WALLETS)) await ensureWallet(name);
  let balance = await rpc("getbalance", [], WALLETS.payer);
  if (balance < 100) {
    const address = await rpc(
      "getnewaddress",
      ["local-test-mining"],
      WALLETS.payer,
    );
    await rpc("generatetoaddress", [110, address], undefined, {
      timeout: 60000,
    });
    balance = await rpc("getbalance", [], WALLETS.payer);
  }
  if ((await rpc("getbalance", [], WALLETS.merchant)) < 1) {
    const feeReserveAddress = await rpc(
      "getnewaddress",
      ["local-refund-fee-reserve"],
      WALLETS.merchant,
    );
    await rpc("sendtoaddress", [feeReserveAddress, 2], WALLETS.payer);
    const miningAddress = await rpc(
      "getnewaddress",
      ["local-test-mining"],
      WALLETS.payer,
    );
    await rpc("generatetoaddress", [1, miningAddress]);
    balance = await rpc("getbalance", [], WALLETS.payer);
  }
  const info = await assertRegtest();
  const result = {
    status: "running",
    chain: info.chain,
    blocks: info.blocks,
    rpc: `http://127.0.0.1:${RPC_PORT}`,
    payerBalance: balance,
    wallets: await rpc("listwallets"),
    runtime: RUNTIME_DIR,
    instantSend: "not active: this prototype has no masternode quorums",
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
