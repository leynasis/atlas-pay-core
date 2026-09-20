import { setTimeout as delay } from "node:timers/promises";
import {
  LAB_NAME,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
} from "../lab/config.mjs";
import {
  merchantReadRpc,
  inspectNode,
  rpc as administrativeRpc,
  assertLabNode,
} from "../lab/rpc.mjs";
import { getLabStatus } from "../lab/status.mjs";
import { AppError } from "../server/errors.mjs";

export const MERCHANT_IDENTITY = Object.freeze({
  chain: EXPECTED_CHAIN,
  devnetName: LAB_NAME,
  genesisHash: GENESIS_HASH,
  devnetGenesisHash: DEVNET_GENESIS_HASH,
});

export function merchantContext() {
  return {
    identity: MERCHANT_IDENTITY,
    rpc: merchantReadRpc,
    assertNetwork: () =>
      inspectNode("merchant", (_node, method, params = []) =>
        merchantReadRpc(method, params),
      ),
    mineDevelopment,
    labStatus: getLabStatus,
  };
}

export async function mineDevelopment({ blocks, pendingTxids = [] }) {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 10)
    throw new AppError("INVALID_BLOCKS", "Mine 1–10 local devnet blocks.");
  // This isolated development helper can access only the miner's administrative
  // transport. Invoice and wallet reads use separate restricted credentials.
  const minerRpc = (method, params = [], wallet) =>
    administrativeRpc("miner", method, params, wallet);
  await assertLabNode("miner");
  const deadline = Date.now() + 10_000;
  for (const txid of pendingTxids) {
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await minerRpc("getmempoolentry", [txid]);
        ready = true;
        break;
      } catch (error) {
        if (error.code !== -5)
          throw new AppError(
            "MINER_UNAVAILABLE",
            "The local miner is unavailable.",
            503,
          );
      }
      try {
        if (
          (await merchantReadRpc("gettransaction", [txid])).confirmations >= 1
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded relay wait */
      }
      await delay(100);
    }
    if (!ready)
      throw new AppError(
        "RELAY_TIMEOUT",
        "The pending transaction has not reached the miner. Wait for local P2P relay and try confirming again.",
        409,
      );
  }
  await assertLabNode("miner");
  const address = await minerRpc(
    "getnewaddress",
    ["atlas-devnet-ui-mining"],
    "miner",
  );
  await minerRpc("generatetoaddress", [blocks, address]);
  const info = await assertLabNode("miner");
  const syncDeadline = Date.now() + 10_000;
  let synchronized = false;
  while (Date.now() < syncDeadline) {
    const status = await getLabStatus();
    if (status.synchronized && status.commonHeight >= info.blocks) {
      synchronized = true;
      break;
    }
    await delay(100);
  }
  return {
    blockHeight: info.blocks,
    synchronized,
    mode: "local-devnet-test",
    waitedForTransactions: pendingTxids.length,
  };
}
