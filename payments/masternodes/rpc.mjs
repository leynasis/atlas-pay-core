import { readFile } from "node:fs/promises";
import { parseRpcJson } from "../server/rpc.mjs";
import { NODES, CHAIN, GENESIS_HASH, DEVNET_GENESIS_HASH } from "./config.mjs";
export async function rpc(id, method, params = [], wallet, timeout = 15000) {
  const node = NODES[id];
  if (!node) throw new Error("Unknown isolated masternode-lab node");
  const cookie = (await readFile(node.cookie, "utf8")).trim();
  const path = wallet ? `/wallet/${encodeURIComponent(wallet)}` : "/";
  const response = await fetch(`http://127.0.0.1:${node.rpcPort}${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "lave-quorum-lab",
      method,
      params,
    }),
  });
  if (response.status === 401 || response.status === 403)
    throw new Error(`Lab RPC authorization failed on ${id}`);
  const body = parseRpcJson(await response.text());
  if (body.error) {
    const error = new Error(`${id}.${method}: ${body.error.message}`);
    error.code = body.error.code;
    throw error;
  }
  if (!response.ok || !Object.hasOwn(body, "result"))
    throw new Error(`Invalid RPC response from ${id}`);
  return body.result;
}
export async function assertNode(id) {
  const [chain, genesis, named, peers] = await Promise.all([
    rpc(id, "getblockchaininfo"),
    rpc(id, "getblockhash", [0]),
    rpc(id, "getblockhash", [1]),
    rpc(id, "getpeerinfo"),
  ]);
  if (
    chain.chain !== CHAIN ||
    genesis !== GENESIS_HASH ||
    named !== DEVNET_GENESIS_HASH
  )
    throw new Error(`Wrong chain on ${id}; refusing isolated-lab operation`);
  for (const peer of peers) {
    if (
      !/^127\.0\.0\.1:\d+$/.test(peer.addr) ||
      (!peer.inbound &&
        !Object.values(NODES).some(
          (node) => peer.addr === `127.0.0.1:${node.p2pPort}`,
        ))
    )
      throw new Error(`Non-lab peer on ${id}; refusing operation`);
    if (
      peer.subver &&
      !peer.subver.split(/[();\s]+/).includes(`devnet.${CHAIN}`)
    )
      throw new Error(`Wrong network peer on ${id}`);
  }
  return chain;
}
