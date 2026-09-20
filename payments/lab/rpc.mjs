import { readFile } from "node:fs/promises";
import { parseRpcJson } from "../server/rpc.mjs";
import {
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  MINER_API_METHODS,
  MINER_API_CREDENTIALS_PATH,
  MERCHANT_API_METHODS,
  MERCHANT_API_CREDENTIALS_PATH,
  NODES,
  MASTERNODE_P2P_PORTS,
  READ_ONLY_METHODS,
  getNode,
} from "./config.mjs";

async function request(
  nodeId,
  method,
  params,
  wallet,
  credentials,
  timeout = 15000,
) {
  const node = getNode(nodeId);
  const path =
    wallet === undefined ? "/" : `/wallet/${encodeURIComponent(wallet)}`;
  const response = await fetch(`${node.rpcUrl}${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "lavepay-local-lab",
      method,
      params,
    }),
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error(
      `Lab RPC access denied on ${nodeId} (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  const body = parseRpcJson(await response.text());
  if (body.error) {
    const error = new Error(
      `Lab RPC ${nodeId}.${method}: ${body.error.message}`,
    );
    error.code = body.error.code;
    throw error;
  }
  if (!response.ok || !Object.hasOwn(body, "result"))
    throw new Error(`Invalid lab RPC response on ${nodeId}.`);
  return body.result;
}

// Administrative local CLI transport. Monetary callers must assertLabNode
// immediately before a write. Dashboard code must use readOnlyRpc instead.
export async function rpc(
  nodeId,
  method,
  params = [],
  wallet,
  { timeout = 15000 } = {},
) {
  const cookie = (await readFile(getNode(nodeId).cookiePath, "utf8")).trim();
  return request(nodeId, method, params, wallet, cookie, timeout);
}

export async function readOnlyRpc(nodeId, method, params = []) {
  if (!READ_ONLY_METHODS.includes(method))
    throw new Error(`Dashboard RPC method is not allowed: ${method}`);
  const credential = JSON.parse(
    await readFile(getNode(nodeId).dashboardCredentialsPath, "utf8"),
  );
  return request(
    nodeId,
    method,
    params,
    undefined,
    `${credential.username}:${credential.password}`,
    4000,
  );
}

export async function merchantReadRpc(
  method,
  params = [],
  wallet = NODES.merchant.wallet,
) {
  if (
    !MERCHANT_API_METHODS.includes(method) ||
    wallet !== NODES.merchant.wallet
  )
    throw new Error("Merchant API RPC method or wallet is not allowed.");
  const credential = JSON.parse(
    await readFile(MERCHANT_API_CREDENTIALS_PATH, "utf8"),
  );
  return request(
    "merchant",
    method,
    params,
    wallet,
    `${credential.username}:${credential.password}`,
  );
}

export async function minerDevelopmentRpc(method, params = []) {
  if (!MINER_API_METHODS.includes(method))
    throw new Error("Development miner RPC method is not allowed.");
  const credential = JSON.parse(
    await readFile(MINER_API_CREDENTIALS_PATH, "utf8"),
  );
  return request(
    "miner",
    method,
    params,
    NODES.miner.wallet,
    `${credential.username}:${credential.password}`,
  );
}

export function verifyIdentity(chain, genesis, devnetGenesis) {
  if (
    chain !== EXPECTED_CHAIN ||
    genesis !== GENESIS_HASH ||
    devnetGenesis !== DEVNET_GENESIS_HASH
  ) {
    throw new Error(
      "Lab identity mismatch: named chain and both pinned genesis hashes must match.",
    );
  }
}

export function verifyPeers(nodeId, peers) {
  getNode(nodeId);
  if (!Array.isArray(peers)) throw new Error("Invalid lab peer response.");
  const expectedDestinations = Object.values(NODES)
    .filter((node) => node.id !== nodeId)
    .map((node) => `127.0.0.1:${node.p2pPort}`)
    .concat(MASTERNODE_P2P_PORTS.map((port) => `127.0.0.1:${port}`));
  let handshakePending = false;
  for (const peer of peers) {
    // An incoming TCP source port is ephemeral, not the peer's listening port.
    // Only loopback is accepted; outbound peers must use exact pinned ports.
    if (
      !peer ||
      typeof peer.addr !== "string" ||
      !/^127\.0\.0\.1:\d+$/.test(peer.addr) ||
      typeof peer.inbound !== "boolean" ||
      (!peer.inbound && !expectedDestinations.includes(peer.addr)) ||
      typeof peer.subver !== "string" ||
      (peer.subver !== "" &&
        !peer.subver.split(/[();\s]+/).includes(`devnet.${EXPECTED_CHAIN}`))
    ) {
      throw new Error(
        "Lab peer isolation failed: peer is outside the local named-devnet allowlist.",
      );
    }
    // getpeerinfo exposes a connected socket before VERSION fills cleanSubVer.
    // Keep monetary guards closed; only lifecycle connection waits may retry.
    if (peer.subver === "") handshakePending = true;
  }
  // Check every peer first: an unfinished handshake must not hide a bad peer.
  if (handshakePending) {
    const error = new Error("Lab peer handshake is not complete.");
    error.code = "LAB_PEER_HANDSHAKE_PENDING";
    throw error;
  }
}

export async function inspectNode(
  nodeId,
  transport = rpc,
  { allowInactive = false } = {},
) {
  const [chain, network, peers, genesis, devnetGenesis] = await Promise.all([
    transport(nodeId, "getblockchaininfo"),
    transport(nodeId, "getnetworkinfo"),
    transport(nodeId, "getpeerinfo"),
    transport(nodeId, "getblockhash", [0]),
    transport(nodeId, "getblockhash", [1]),
  ]);
  verifyIdentity(chain.chain, genesis, devnetGenesis);
  if (
    network.networkactive !== true &&
    !(allowInactive && network.networkactive === false)
  ) {
    throw new Error(
      "Lab node does not have the expected explicit P2P setting.",
    );
  }
  verifyPeers(nodeId, peers);
  return {
    ...chain,
    genesisHash: genesis,
    devnetGenesisHash: devnetGenesis,
    network,
    peers,
  };
}

export function assertLabNode(nodeId, options) {
  return inspectNode(nodeId, rpc, options);
}
