import { setTimeout as delay } from "node:timers/promises";
import { NETWORK_IDENTITY, PROFILE } from "../lab/config.mjs";
import {
  merchantReadRpc,
  inspectNode,
  minerDevelopmentRpc,
} from "../lab/rpc.mjs";
import { getLabStatus } from "../lab/status.mjs";
import { AppError } from "../server/errors.mjs";

export const MERCHANT_IDENTITY = NETWORK_IDENTITY;

export function merchantContext() {
  return {
    identity: MERCHANT_IDENTITY,
    rpc: merchantReadRpc,
    watchOnly: PROFILE === "lave",
    assertNetwork: async () => {
      const info = await inspectNode("merchant", (_node, method, params = []) =>
        merchantReadRpc(method, params),
      );
      if (PROFILE === "lave") {
        const wallet = await merchantReadRpc("getwalletinfo");
        if (
          wallet.private_keys_enabled !== false ||
          wallet.descriptors !== true
        )
          throw new AppError(
            "CUSTODY_MISMATCH",
            "The cashier must use its verified watch-only descriptor wallet.",
            503,
          );
      }
      return info;
    },
    mineDevelopment,
    labStatus: getLabStatus,
  };
}

export async function mineDevelopment({ blocks, pendingTxids = [] }) {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 10)
    throw new AppError("INVALID_BLOCKS", "Mine 1–10 local devnet blocks.");
  // Development mining gets a separate method-limited credential, never an
  // administrator cookie. It cannot spend wallet funds or export keys.
  const minerRpc = minerDevelopmentRpc;
  const inspectMiner = () =>
    inspectNode("miner", (_node, method, params = []) =>
      minerRpc(method, params),
    );
  await inspectMiner();
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
  await inspectMiner();
  const address = await minerRpc(
    "getnewaddress",
    ["lavepay-devnet-ui-mining"],
    "miner",
  );
  await minerRpc("generatetoaddress", [blocks, address]);
  const info = await inspectMiner();
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
