import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const children = new Set();
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

for (const [label, script, ...args] of [
  ["Merchant workspace", "merchant/index.mjs"],
  ["Customer wallet", "wallet/index.mjs", "customer"],
  ["Merchant wallet", "wallet/index.mjs", "merchant"],
]) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.add(child);
  child.once("error", () => {
    console.error(`${label} could not start. Stopping the local applications.`);
    children.delete(child);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(
        `${label} stopped (${signal || code}). Stopping the local applications.`,
      );
      stop(code === 0 ? 0 : 1);
    }
  });
}
