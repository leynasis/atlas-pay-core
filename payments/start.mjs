import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cashierCommand, cashierEnvironment } from "./isolation/profile.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const children = new Set();
let stopping = false;
const selected = process.argv[2];
if (selected && selected !== "merchant")
  throw new Error("Usage: node start.mjs [merchant]");

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
  if (selected === "merchant" && script !== "merchant/index.mjs") continue;
  const cashier = script === "merchant/index.mjs";
  const invocation = cashier
    ? cashierCommand(script, args)
    : { command: process.execPath, args: [script, ...args] };
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    stdio: "inherit",
    env: cashier ? cashierEnvironment(invocation.mode) : process.env,
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
