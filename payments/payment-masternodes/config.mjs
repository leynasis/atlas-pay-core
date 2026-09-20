import { join } from "node:path";
import { networkProfile } from "../lab/profiles.mjs";
const profile = networkProfile("lave");
export const NAME = profile.devnetName;
export const CHAIN = `devnet-${NAME}`;
export const CURRENCY = "LAVE";
export const GENESIS_HASH = profile.genesisHash;
export const DEVNET_GENESIS_HASH = profile.devnetGenesisHash;
export const IDENTITY = Object.freeze({
  name: NAME,
  chain: CHAIN,
  genesisHash: GENESIS_HASH,
  devnetGenesisHash: DEVNET_GENESIS_HASH,
});
export const WALLET = "lave-quorum-seeds";
export const RUNTIME = join(profile.runtimeDir, "payment-masternodes");
export const PUBLIC_DIR = join(RUNTIME, "public");
export const STATE_PATH = join(RUNTIME, "state.json");
export const DAEMON = profile.daemonPath;
export const EXISTING_IDS = ["miner", "merchant", "customer", "signer"];
export const MN_IDS = Array.from({ length: 16 }, (_, i) => `seed${i + 1}`);
export const NODE_IDS = [...EXISTING_IDS, ...MN_IDS];
export const NODES = Object.freeze(
  Object.fromEntries(
    NODE_IDS.map((id, index) => {
      const seed = index >= EXISTING_IDS.length;
      const offset = seed ? index - EXISTING_IDS.length : index;
      const datadir = seed
        ? join(RUNTIME, "nodes", id)
        : join(profile.runtimeDir, "lab", id);
      return [
        id,
        Object.freeze({
          id,
          role: seed ? "seed-masternode" : "payment-node",
          rpcPort: (seed ? 20301 : 20001) + offset,
          p2pPort: (seed ? 20401 : 20011) + offset,
          datadir,
          conf: join(datadir, "lave.conf"),
          cookie: join(datadir, CHAIN, ".cookie"),
          operator: join(datadir, "operator.json"),
        }),
      ];
    }),
  ),
);
export const ALLOWED_P2P_PORTS = [
  ...Object.values(NODES).map((node) => node.p2pPort),
  20211,
  20212,
];
export const QUORUMS = Object.freeze({
  chainLocks: {
    type: 101,
    name: "llmq_devnet",
    size: 12,
    minSize: 7,
    threshold: 6,
    active: 4,
    interval: 24,
  },
  instantSend: {
    type: 105,
    name: "llmq_devnet_dip0024",
    size: 8,
    minSize: 6,
    threshold: 4,
    active: 2,
    interval: 48,
  },
});
