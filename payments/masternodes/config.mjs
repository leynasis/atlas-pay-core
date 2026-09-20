import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const NAME = "lave-quorum-v1";
export const CHAIN = `devnet-${NAME}`;
export const CURRENCY = "LAVE-Q";
export const GENESIS_HASH =
  "3db65802980f975c71d3c4e095a0d45304b4e419a09fd2182aee54cb3eaed4de";
export const DEVNET_GENESIS_HASH =
  "4d77c6b3447becea615bebe369a6771937d6d2722baf99060f9704f7b112a4e1";
export const IDENTITY = Object.freeze({
  name: NAME,
  chain: CHAIN,
  genesisHash: GENESIS_HASH,
  devnetGenesisHash: DEVNET_GENESIS_HASH,
});
export const RUNTIME = fileURLToPath(
  new URL("../.runtime/masternodes/", import.meta.url),
);
export const CORE_RUNTIME = fileURLToPath(
  new URL("../.runtime/lave-core/", import.meta.url),
);
export const DAEMON = join(CORE_RUNTIME, "bin", "laved");
export const PUBLIC_DIR = join(RUNTIME, "public");
export const STATE_PATH = join(RUNTIME, "state.json");
export const NODE_IDS = [
  "controller",
  ...Array.from({ length: 8 }, (_, i) => `mn${i + 1}`),
];
export const MN_IDS = NODE_IDS.slice(1);
export const NODES = Object.fromEntries(
  NODE_IDS.map((id, index) => {
    const datadir = join(RUNTIME, "nodes", id);
    return [
      id,
      Object.freeze({
        id,
        role: index ? "masternode" : "controller",
        rpcPort: 20101 + index,
        p2pPort: 20111 + index,
        datadir,
        conf: join(datadir, "lave.conf"),
        cookie: join(datadir, CHAIN, ".cookie"),
        operator: join(datadir, "operator.json"),
      }),
    ];
  }),
);
export const QUORUMS = Object.freeze({
  chainLocks: {
    type: 100,
    name: "llmq_test",
    size: 3,
    minSize: 2,
    threshold: 2,
  },
  instantSend: {
    type: 103,
    name: "llmq_test_dip0024",
    size: 4,
    minSize: 4,
    threshold: 3,
  },
});
