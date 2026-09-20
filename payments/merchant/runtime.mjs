import { setTimeout as delay } from "node:timers/promises";
import { NETWORK_IDENTITY, PROFILE } from "../lab/config.mjs";
import {
  merchantReadRpc,
  inspectNode,
  minerDevelopmentRpc,
} from "../lab/rpc.mjs";
import { getLabStatus } from "../lab/status.mjs";
import { getPaymentMasternodeStatus } from "../lab/payment-masternodes.mjs";
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
    masternodeStatus: getPaymentMasternodeStatus,
  };
}

export async function mineDevelopment(
  { blocks, pendingTxids = [] },
  {
    minerRpc = minerDevelopmentRpc,
    merchantRpc = merchantReadRpc,
    labStatus = getLabStatus,
    profile = PROFILE,
    now = Date.now,
    sleep = delay,
    waitMs = 10_000,
  } = {},
) {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 10)
    throw new AppError("INVALID_BLOCKS", "Mine 1–10 local devnet blocks.");
  // Development mining gets a separate method-limited credential, never an
  // administrator cookie. It cannot spend wallet funds or export keys.
  const inspectMiner = () =>
    inspectNode("miner", (_node, method, params = []) =>
      minerRpc(method, params),
    );
  const isConfirmed = async (txid) => {
    try {
      return (
        (await merchantRpc("gettransaction", [txid, profile === "lave"]))
          .confirmations >= 1
      );
    } catch (error) {
      if (error.code === -5 || error.rpcCode === -5) return false;
      throw new AppError(
        "MERCHANT_UNAVAILABLE",
        "The merchant cannot verify the payment confirmation. Try again when its local node is available.",
        503,
      );
    }
  };
  await inspectMiner();
  const deadline = now() + waitMs;
  for (const txid of pendingTxids) {
    let ready = false;
    let relayed = false;
    while (now() < deadline) {
      try {
        const entry = await minerRpc("getmempoolentry", [txid]);
        relayed = true;
        // Core returns string booleans here. A fresh unlocked LAVE payment
        // may be excluded from a block despite being present in the mempool.
        const locked =
          entry.instantlock === "true" || entry.instantlock === true;
        const oldEnough =
          Number.isSafeInteger(entry.time) &&
          entry.time >= 0 &&
          Math.floor(now() / 1000) - entry.time >= 600;
        if (profile !== "lave" || locked || oldEnough) {
          ready = true;
          break;
        }
      } catch (error) {
        if (error.code !== -5 && error.rpcCode !== -5)
          throw new AppError(
            "MINER_UNAVAILABLE",
            "The local miner is unavailable.",
            503,
          );
      }
      if (await isConfirmed(txid)) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) {
      if (relayed && profile === "lave")
        throw new AppError(
          "PAYMENT_NOT_MINEABLE",
          "The payment reached the miner but is still waiting for InstantSend or the 10-minute mining safety delay. No block was mined. Wait and try confirming again.",
          409,
        );
      throw new AppError(
        "RELAY_TIMEOUT",
        "The pending transaction has not reached the miner. Wait for local P2P relay and try confirming again.",
        409,
      );
    }
  }
  await inspectMiner();
  const address = await minerRpc(
    "getnewaddress",
    ["lavepay-devnet-ui-mining"],
    "miner",
  );
  await minerRpc("generatetoaddress", [blocks, address]);
  const info = await inspectMiner();
  const syncDeadline = now() + waitMs;
  let synchronized = false;
  let paymentsConfirmed = pendingTxids.length === 0;
  while (now() < syncDeadline) {
    const status = await labStatus();
    synchronized = status.synchronized && status.commonHeight >= info.blocks;
    if (synchronized) {
      // Mempool age only permits an attempt: Core's mining safety age is
      // tracked separately. Never infer inclusion from a newly mined block.
      paymentsConfirmed = (
        await Promise.all(pendingTxids.map(isConfirmed))
      ).every(Boolean);
      if (paymentsConfirmed) break;
    }
    await sleep(100);
  }
  if (pendingTxids.length && (!synchronized || !paymentsConfirmed))
    throw new AppError(
      "PAYMENT_NOT_CONFIRMED",
      "A local block was mined, but the payment is not yet confirmed across the payment nodes. Wait for synchronization or InstantSend and try confirming again.",
      409,
    );
  return {
    blockHeight: info.blocks,
    synchronized,
    mode: "local-devnet-test",
    waitedForTransactions: pendingTxids.length,
  };
}
