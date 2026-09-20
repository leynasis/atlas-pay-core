import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { IDENTITY, RUNTIME, STATE_PATH, PUBLIC_DIR } from "./config.mjs";
export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.next`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}
export async function loadState() {
  const state = await readJson(STATE_PATH);
  if (state && JSON.stringify(state.identity) !== JSON.stringify(IDENTITY))
    throw new Error(
      "Masternode lab state belongs to a different pinned network",
    );
  return (
    state || {
      format: 1,
      identity: IDENTITY,
      createdAt: new Date().toISOString(),
      masternodes: {},
      mockTime: Math.floor(Date.now() / 1000),
      funding: null,
    }
  );
}
export function saveState(state) {
  return writeJson(STATE_PATH, state);
}
export async function progress(phase, message) {
  console.log(`[${phase}] ${message}`);
  await writeJson(join(PUBLIC_DIR, "bootstrap.json"), {
    phase,
    message,
    updatedAt: new Date().toISOString(),
  });
}
export async function exclusive(fn) {
  const lock = join(RUNTIME, "mutation.lock");
  await mkdir(RUNTIME, { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "A masternode-lab operation is running; inspect mutation.lock before removing any stale lock",
      );
    throw error;
  }
  try {
    await writeJson(join(lock, "owner.json"), {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
