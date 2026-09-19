import { readFile } from "node:fs/promises";
import { COOKIE_PATH, RPC_URL } from "./config.mjs";

/** Local regtest only. Cookie is read per request to tolerate daemon restarts. */
export async function rpc(
  method,
  params = [],
  wallet,
  { timeout = 15000 } = {},
) {
  const cookie = (await readFile(COOKIE_PATH, "utf8")).trim();
  const path =
    wallet === undefined ? "/" : `/wallet/${encodeURIComponent(wallet)}`;
  const response = await fetch(`${RPC_URL}${path}`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "local-payments",
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status === 401)
    throw new Error(
      "Local Dash RPC authentication failed. Restart the isolated network.",
    );
  const body = await response.json();
  if (body.error) {
    const error = new Error(`Dash RPC ${method}: ${body.error.message}`);
    error.code = body.error.code;
    throw error;
  }
  if (!response.ok)
    throw new Error(`Dash RPC returned HTTP ${response.status}`);
  return body.result;
}

export async function assertRegtest() {
  const info = await rpc("getblockchaininfo");
  if (info.chain !== "regtest")
    throw new Error("Refusing to use any chain except regtest.");
  const network = await rpc("getnetworkinfo");
  if (network.networkactive !== false || network.connections !== 0) {
    throw new Error(
      "Refusing to use a node with P2P networking enabled or connected peers.",
    );
  }
  return info;
}
