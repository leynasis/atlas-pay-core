import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_CONFIG,
  LAB_DIR,
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  NODE_IDS,
  NODES,
  getNode,
} from "../lab/config.mjs";
import {
  inspectNode,
  readOnlyRpc,
  verifyIdentity,
  verifyPeers,
} from "../lab/rpc.mjs";
import { connectLab } from "../lab/lifecycle.mjs";

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
    addr: `127.0.0.1:${NODES.merchant.p2pPort}`,
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

test("unfinished local handshakes fail closed without masking invalid peers", () => {
  const pending = {
    addr: `127.0.0.1:${NODES.merchant.p2pPort}`,
    inbound: false,
    subver: "",
  };
  assert.throws(() => verifyPeers("miner", [pending]), {
    code: "LAB_PEER_HANDSHAKE_PENDING",
  });
  for (const invalid of [
    { ...pending, addr: "192.168.1.10:19912" },
    { ...pending, addr: "127.0.0.1:9999" },
    { ...pending, inbound: "true" },
    { ...pending, subver: undefined },
    { ...pending, subver: "/Dash Core:23.1.8(devnet.other)/" },
  ]) {
    assert.throws(() => verifyPeers("miner", [pending, invalid]), /isolation/);
  }
});

function connectionTransport(peerResult) {
  const reads = new Map(NODE_IDS.map((id) => [id, 0]));
  const writes = [];
  const transport = async (id, method, params) => {
    if (method === "addnode") {
      writes.push({ id, params, reads: reads.get(id) });
      return null;
    }
    if (method === "getpeerinfo") {
      const count = reads.get(id) + 1;
      reads.set(id, count);
      const target =
        NODES[NODE_IDS[(NODE_IDS.indexOf(id) + 1) % NODE_IDS.length]];
      const peers = [
        {
          addr: `127.0.0.1:${target.p2pPort}`,
          inbound: false,
          subver: `/Dash Core:23.1.8(devnet.${EXPECTED_CHAIN})/`,
        },
        {
          addr: "127.0.0.1:54321",
          inbound: true,
          subver: `/Dash Core:23.1.8(devnet.${EXPECTED_CHAIN})/`,
        },
      ];
      return peerResult(peers, count);
    }
    return {
      getblockchaininfo: { chain: EXPECTED_CHAIN, blocks: 1 },
      getnetworkinfo: { networkactive: true },
      getblockhash: params?.[0] === 0 ? GENESIS_HASH : DEVNET_GENESIS_HASH,
    }[method];
  };
  return { transport, reads, writes };
}

test("connectLab waits for initial and final handshakes before declaring ready", async () => {
  const fake = connectionTransport((peers, count) => {
    if (count === 1 || count === 3)
      return [{ ...peers[0], subver: "" }, peers[1]];
    // No outbound link yet: only a fully inspected node may receive addnode.
    return count === 2 ? [peers[1]] : peers;
  });
  await connectLab({ transport: fake.transport, timeout: 2000 });
  assert.deepEqual(
    [...fake.reads.values()],
    NODE_IDS.map(() => 4),
  );
  assert.equal(fake.writes.length, NODE_IDS.length);
  for (let i = 0; i < NODE_IDS.length; i++) {
    assert.deepEqual(fake.writes[i], {
      id: NODE_IDS[i],
      params: [
        `127.0.0.1:${NODES[NODE_IDS[(i + 1) % NODE_IDS.length]].p2pPort}`,
        "onetry",
      ],
      reads: 2,
    });
  }
});

test("connectLab never retries wrong devnets and bounds an unfinished handshake", async () => {
  const invalid = connectionTransport((peers) => [
    { ...peers[0], subver: "" },
    { ...peers[1], subver: "/Dash Core:23.1.8(devnet.other)/" },
  ]);
  await assert.rejects(
    connectLab({ transport: invalid.transport, timeout: 1000 }),
    /isolation/,
  );
  assert.equal(invalid.reads.get("miner"), 1);
  assert.equal(invalid.writes.length, 0);
  const pending = connectionTransport((peers) => [{ ...peers[0], subver: "" }]);
  await assert.rejects(
    connectLab({ transport: pending.transport, timeout: 25 }),
    /did not become ready/,
  );
  assert.equal(pending.writes.length, 0);
  await assert.rejects(inspectNode("miner", pending.transport), {
    code: "LAB_PEER_HANDSHAKE_PENDING",
  });
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
    NODE_IDS.map((_, offset) => PROFILE_CONFIG.rpcBase + offset),
  );
  assert.equal(
    new Set(Object.values(NODES).map((node) => node.cookiePath)).size,
    NODE_IDS.length,
  );
  assert.throws(() => getNode("main"), /Unknown lab node/);
  assert.throws(() => getNode("__proto__"), /Unknown lab node/);
  for (const node of Object.values(NODES)) {
    assert.equal(
      node.cookiePath,
      `${LAB_DIR}/${node.id}/${EXPECTED_CHAIN}/.cookie`,
    );
    assert.notEqual(node.cookiePath, node.dashboardCredentialsPath);
  }
});
