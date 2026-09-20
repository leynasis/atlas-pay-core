import { join } from "node:path";
import { networkProfile, profileIdentity } from "./profiles.mjs";

export const PROFILE_CONFIG = networkProfile(process.env.LAVEPAY_NETWORK);
export const PROFILE = PROFILE_CONFIG.name;
export const CURRENCY = PROFILE_CONFIG.currency;
export const RUNTIME_DIR = PROFILE_CONFIG.runtimeDir;
export const LAB_NAME = PROFILE_CONFIG.devnetName;
export const EXPECTED_CHAIN = `devnet-${LAB_NAME}`;
export const LAB_DIR = join(RUNTIME_DIR, "lab");
export const MERCHANT_DB_PATH = join(
  RUNTIME_DIR,
  "merchant",
  "invoices.sqlite",
);
export const SIGNER_DIR = join(RUNTIME_DIR, "signer");
export const LAB_DAEMON_PATH = PROFILE_CONFIG.daemonPath;
export const GENESIS_HASH = PROFILE_CONFIG.genesisHash;
export const DEVNET_GENESIS_HASH = PROFILE_CONFIG.devnetGenesisHash;
export const NETWORK_IDENTITY = profileIdentity(PROFILE_CONFIG);
export const MINIMUM_DIFFICULTY_BLOCKS = 10000;
// v23.1.8's default highsubsidyblocks=0 rejects its 50 DASH devnet genesis
// against a 5 DASH limit. One block retains the historical allowance solely
// for genesis. The multiplier remains 1; later blocks use upstream defaults.
export const HIGH_SUBSIDY_BLOCKS = 1;
export const HIGH_SUBSIDY_FACTOR = 1;
export const READ_ONLY_METHODS = Object.freeze([
  "getblockchaininfo",
  "getnetworkinfo",
  "getpeerinfo",
  "getblockhash",
]);
export const MERCHANT_API_METHODS = Object.freeze([
  ...READ_ONLY_METHODS,
  "getnewaddress",
  "getbalance",
  "getwalletinfo",
  "listdescriptors",
  "listreceivedbyaddress",
  "gettransaction",
  "getmempoolentry",
  "getaddressinfo",
  "validateaddress",
  "decoderawtransaction",
]);
export const MINER_API_METHODS = Object.freeze([
  ...READ_ONLY_METHODS,
  "getnewaddress",
  "generatetoaddress",
  "getmempoolentry",
]);
export const MINER_API_CREDENTIALS_PATH = join(
  LAB_DIR,
  "miner-api",
  "credentials.json",
);
export const MERCHANT_API_CREDENTIALS_PATH = join(
  LAB_DIR,
  "merchant-api",
  "credentials.json",
);

export const NODES = Object.freeze(
  Object.fromEntries(
    [
      ["miner", "Block producer", 0],
      ["merchant", "Merchant node", 1],
      ["customer", "Customer signer", 2],
      ...(PROFILE === "lave" ? [["signer", "Merchant signer", 3]] : []),
    ].map(([id, label, offset]) => {
      const rpcPort = PROFILE_CONFIG.rpcBase + offset;
      const p2pPort = PROFILE_CONFIG.p2pBase + offset;
      const datadir = join(LAB_DIR, id);
      return [
        id,
        Object.freeze({
          id,
          label,
          rpcPort,
          p2pPort,
          wallet:
            PROFILE === "lave" && id === "merchant"
              ? "cashier"
              : id === "signer"
                ? "merchant"
                : id,
          datadir,
          rpcUrl: `http://127.0.0.1:${rpcPort}`,
          configPath: join(datadir, PROFILE_CONFIG.configFilename),
          cookiePath: join(datadir, EXPECTED_CHAIN, ".cookie"),
          pidPath: join(datadir, EXPECTED_CHAIN, PROFILE_CONFIG.pidFilename),
          dashboardCredentialsPath: join(LAB_DIR, "dashboard", `${id}.json`),
        }),
      ];
    }),
  ),
);
export const NODE_IDS = Object.freeze(Object.keys(NODES));
// Fixed loopback services belonging to this payment devnet. Never accept the
// separate LAVE-Q laboratory ports or caller-supplied destinations.
export const MASTERNODE_P2P_PORTS = Object.freeze(
  PROFILE === "lave"
    ? [20211, 20212, ...Array.from({ length: 16 }, (_, index) => 20401 + index)]
    : [],
);
export function getNode(nodeId) {
  if (!Object.hasOwn(NODES, nodeId))
    throw new Error(`Unknown lab node: ${nodeId}`);
  return NODES[nodeId];
}

export const ROLE_NODES = Object.freeze({
  customer: "customer",
  merchant: PROFILE === "lave" ? "signer" : "merchant",
});
export const ROLE_WALLETS = Object.freeze({
  customer: "customer",
  merchant: "merchant",
});
