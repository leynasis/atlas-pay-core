import { exclusive } from "./state.mjs";
import { startLab, stopLab, mineQuorums, mine } from "./lifecycle.mjs";
import { getMasternodeStatus } from "./status.mjs";
import { publishStatus } from "./monitor.mjs";

const command = process.argv[2] || "status";
try {
  if (command === "status")
    console.log(JSON.stringify(await getMasternodeStatus(), null, 2));
  else
    await exclusive(async () => {
      if (command === "start") {
        const state = await startLab();
        await mineQuorums(state);
        await publishStatus();
      } else if (command === "stop") await stopLab();
      else if (command === "mine") {
        const { loadState } = await import("./state.mjs");
        await mine(await loadState(), Number(process.argv[3] || 1), {
          pace: 1100,
        });
        await publishStatus();
      } else if (command === "verify") {
        const { verifyLab } = await import("./verify.mjs");
        await verifyLab();
      } else
        throw new Error("Use start, status, mine [count], verify, or stop");
    });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
