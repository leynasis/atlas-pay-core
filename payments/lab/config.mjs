import { join } from "node:path";
import { RUNTIME_DIR } from "../network/config.mjs";

export const LAB_NAME = "atlas-local-v1";
export const EXPECTED_CHAIN = `devnet-${LAB_NAME}`;
export const LAB_DIR = join(RUNTIME_DIR, "lab");
export const GENESIS_HASH =
  "000008ca1832a4baf228eb1553c03d3a2c8e02399550dd6ea8d65cec3ef23d2e";
export const DEVNET_GENESIS_HASH =
  "6bf1e63db8f55984d9ddfe93b99f0dd11e5d593c2d7cbdf706c84c11b37827d2";
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

export const NODES = Object.freeze(
  Object.fromEntries(
    [
      ["miner", "Block producer", 19901, 19911],
      ["merchant", "Merchant node", 19902, 19912],
      ["customer", "Customer signer", 19903, 19913],
    ].map(([id, label, rpcPort, p2pPort]) => {
      const datadir = join(LAB_DIR, id);
      return [
        id,
        Object.freeze({
          id,
          label,
          rpcPort,
          p2pPort,
          wallet: id,
          datadir,
          rpcUrl: `http://127.0.0.1:${rpcPort}`,
          configPath: join(datadir, "dash.conf"),
          cookiePath: join(datadir, EXPECTED_CHAIN, ".cookie"),
          pidPath: join(datadir, EXPECTED_CHAIN, "dashd.pid"),
          dashboardCredentialsPath: join(LAB_DIR, "dashboard", `${id}.json`),
        }),
      ];
    }),
  ),
);
export const NODE_IDS = Object.freeze(Object.keys(NODES));
export function getNode(nodeId) {
  if (!Object.hasOwn(NODES, nodeId))
    throw new Error(`Unknown lab node: ${nodeId}`);
  return NODES[nodeId];
}
