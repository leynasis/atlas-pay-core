import { join } from "node:path";
import {
  RUNTIME_DIR,
  DAEMON_PATH as DASH_DAEMON_PATH,
} from "../network/config.mjs";

const profiles = Object.freeze({
  lave: Object.freeze({
    name: "lave",
    currency: "LAVE",
    devnetName: "lave-local-v1",
    genesisHash:
      "28fae923c5ef15cb623f14f61aae383050712a8ef7ff740bb2b1541d8a3bcf9c",
    devnetGenesisHash:
      "2043af4ec0030900338e8ad5eb86428008787d4be468f197d2bcd1776c094209",
    runtimeDir: join(RUNTIME_DIR, "lave"),
    daemonPath: join(RUNTIME_DIR, "lave-core", "bin", "laved"),
    configFilename: "lave.conf",
    pidFilename: "laved.pid",
    rpcBase: 20001,
    p2pBase: 20011,
    descriptors: true,
  }),
  atlas: Object.freeze({
    name: "atlas",
    currency: "DASH",
    devnetName: "atlas-local-v1",
    genesisHash:
      "000008ca1832a4baf228eb1553c03d3a2c8e02399550dd6ea8d65cec3ef23d2e",
    devnetGenesisHash:
      "6bf1e63db8f55984d9ddfe93b99f0dd11e5d593c2d7cbdf706c84c11b37827d2",
    runtimeDir: RUNTIME_DIR,
    daemonPath: DASH_DAEMON_PATH,
    configFilename: "dash.conf",
    pidFilename: "dashd.pid",
    rpcBase: 19901,
    p2pBase: 19911,
    descriptors: false,
  }),
});

export function networkProfile(name = "lave") {
  if (!Object.hasOwn(profiles, name))
    throw new Error(
      "LAVEPAY_NETWORK must be exactly 'lave' or 'atlas'. No other networks are supported.",
    );
  return profiles[name];
}

export function profileIdentity(profile) {
  return Object.freeze({
    chain: `devnet-${profile.devnetName}`,
    devnetName: profile.devnetName,
    genesisHash: profile.genesisHash,
    devnetGenesisHash: profile.devnetGenesisHash,
    // Keep existing Atlas requests byte-for-byte compatible with their checksum.
    ...(profile.name === "lave" ? { currency: profile.currency } : {}),
  });
}
