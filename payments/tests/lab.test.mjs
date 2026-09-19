import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  NODES,
  getNode,
} from "../lab/config.mjs";
import {
  inspectNode,
  readOnlyRpc,
  verifyIdentity,
  verifyPeers,
} from "../lab/rpc.mjs";

test("lab identity requires named chain and both pinned genesis blocks", () => {
  assert.doesNotThrow(() =>
    verifyIdentity(EXPECTED_CHAIN, GENESIS_HASH, DEVNET_GENESIS_HASH),
  );
  assert.throws(
    () => verifyIdentity("regtest", GENESIS_HASH, DEVNET_GENESIS_HASH),
    /identity mismatch/,
  );
  assert.throws(
    () => verifyIdentity(EXPECTED_CHAIN, "0".repeat(64), DEVNET_GENESIS_HASH),
    /identity mismatch/,
  );
  assert.throws(
    () => verifyIdentity(EXPECTED_CHAIN, GENESIS_HASH, "1".repeat(64)),
    /identity mismatch/,
  );
});

test("peer guard checks loopback, exact outbound port and named devnet", () => {
  const peer = {
    addr: "127.0.0.1:19912",
    inbound: false,
    subver: `/Dash Core:23.1.8(devnet.${EXPECTED_CHAIN})/`,
  };
  assert.doesNotThrow(() => verifyPeers("miner", [peer]));
  assert.throws(
    () => verifyPeers("miner", [{ ...peer, addr: "192.168.1.10:19912" }]),
    /isolation/,
  );
  assert.throws(
    () => verifyPeers("miner", [{ ...peer, addr: "127.0.0.1:9999" }]),
    /isolation/,
  );
  assert.throws(
    () => verifyPeers("miner", [{ ...peer, subver: "/Dash Core:23.1.8/" }]),
    /isolation/,
  );
  assert.throws(
    () =>
      verifyPeers("miner", [
        { ...peer, subver: `/Dash Core:23.1.8(devnet.${EXPECTED_CHAIN}0)/` },
      ]),
    /isolation/,
  );
  assert.doesNotThrow(() =>
    verifyPeers("miner", [{ ...peer, inbound: true, addr: "127.0.0.1:54321" }]),
  );
});

test("node guard fails closed for wrong genesis and missing network flag", async () => {
  let expectedBlock = DEVNET_GENESIS_HASH;
  let networkactive = true;
  const transport = async (_id, method, params) =>
    ({
      getblockchaininfo: { chain: EXPECTED_CHAIN, blocks: 1 },
      getnetworkinfo: { networkactive },
      getpeerinfo: [],
      getblockhash: params?.[0] === 0 ? GENESIS_HASH : expectedBlock,
    })[method];
  await inspectNode("miner", transport);
  expectedBlock = "0".repeat(64);
  await assert.rejects(inspectNode("miner", transport), /identity mismatch/);
  expectedBlock = DEVNET_GENESIS_HASH;
  networkactive = undefined;
  await assert.rejects(inspectNode("miner", transport), /P2P/);
  networkactive = false;
  await assert.rejects(inspectNode("miner", transport), /P2P/);
  await inspectNode("miner", transport, { allowInactive: true });
});

test("dashboard transport rejects monetary methods before loading credentials", async () => {
  for (const method of [
    "sendtoaddress",
    "walletprocesspsbt",
    "stop",
    "setnetworkactive",
    "getwalletinfo",
  ]) {
    await assert.rejects(readOnlyRpc("customer", method), /not allowed/);
  }
});

test("node destinations and cookies are fixed and separate from legacy regtest", () => {
  assert.deepEqual(
    Object.values(NODES).map((node) => node.rpcPort),
    [19901, 19902, 19903],
  );
  assert.equal(
    new Set(Object.values(NODES).map((node) => node.cookiePath)).size,
    3,
  );
  assert.throws(() => getNode("main"), /Unknown lab node/);
  assert.throws(() => getNode("__proto__"), /Unknown lab node/);
  for (const node of Object.values(NODES)) {
    assert.match(
      node.cookiePath,
      /lab\/[^/]+\/devnet-atlas-local-v1\/\.cookie$/,
    );
    assert.notEqual(node.cookiePath, node.dashboardCredentialsPath);
  }
});
