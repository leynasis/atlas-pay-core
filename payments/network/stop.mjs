import { setTimeout as delay } from "node:timers/promises";
import { rpc, assertRegtest } from "./rpc.mjs";

try {
  await assertRegtest();
  await rpc("stop");
  let stopped = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(500);
    try {
      await rpc("getblockchaininfo");
    } catch {
      stopped = true;
      break;
    }
  }
  if (!stopped)
    throw new Error("Shutdown requested but the RPC service is still running.");
  console.log("Isolated regtest stopped. Chain and wallets are preserved.");
} catch (error) {
  if (error.code === "ENOENT" || error.cause?.code === "ECONNREFUSED") {
    console.log("Isolated regtest is already stopped.");
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
