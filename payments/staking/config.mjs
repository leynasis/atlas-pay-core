import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkProfile, profileIdentity } from "../lab/profiles.mjs";
import { requirePolicy } from "../signer/policy.mjs";
export const IDENTITY = profileIdentity(networkProfile("lave"));
export const COLLATERAL = "1000";
export const COLLATERAL_SATS = 100_000_000_000n;
export const MAX_FEE_SATS = 10_000n;
export const STAKING_ROOT = fileURLToPath(
  new URL("../.runtime/lave/staking/", import.meta.url),
);
export const PEER_PORTS = Object.freeze([
  20011,
  20012,
  20013,
  20014,
  20211,
  20212,
  ...Array.from({ length: 16 }, (_, i) => 20401 + i),
]);
export function stakingConfig(role) {
  requirePolicy(
    ["customer", "merchant"].includes(role),
    "WRONG_ROLE",
    "Unsupported masternode wallet role.",
  );
  const offset = role === "customer" ? 0 : 1;
  const root = join(STAKING_ROOT, role),
    datadir = join(root, "node");
  return Object.freeze({
    role,
    id: `${role}-local`,
    root,
    datadir,
    rpcPort: 20201 + offset,
    p2pPort: 20211 + offset,
    service: `127.0.0.1:${20211 + offset}`,
    conf: join(datadir, "lave.conf"),
    cookie: join(datadir, IDENTITY.chain, ".cookie"),
    pidPath: join(datadir, IDENTITY.chain, networkProfile("lave").pidFilename),
  });
}
