import test from "node:test";
import assert from "node:assert/strict";
import {
  connectedQuorumMembers,
  dkgConnectionsReady,
} from "./availability.mjs";
const nodes = Array.from({ length: 4 }, (_, i) => ({
  id: `seed${i}`,
  proTxHash: `hash${i}`,
  online: true,
  synchronized: true,
  state: "READY",
  peerCount: 3,
}));
const quorum = {
  threshold: 3,
  members: nodes.map((node) => ({ proTxHash: node.proTxHash, valid: true })),
};
const peers = Object.fromEntries(
  nodes.map((node) => [
    node.id,
    nodes.filter((other) => other !== node).map((other) => other.proTxHash),
  ]),
);
test("quorum availability requires actual authenticated member links", () => {
  assert.equal(connectedQuorumMembers(quorum, nodes, peers), 4);
  assert.equal(connectedQuorumMembers(quorum, nodes, {}), 0);
  assert.equal(
    connectedQuorumMembers(
      quorum,
      nodes,
      Object.fromEntries(
        nodes.map((node) => [node.id, ["foreign", "foreign"]]),
      ),
    ),
    0,
  );
});
test("RPC-alive isolated or unsynced READY members cannot satisfy threshold", () => {
  assert.equal(
    connectedQuorumMembers(
      quorum,
      nodes.map((node, i) => ({ ...node, peerCount: i < 2 ? 0 : 3 })),
      peers,
    ),
    0,
  );
  assert.equal(
    connectedQuorumMembers(
      quorum,
      nodes.map((node, i) => ({ ...node, synchronized: i >= 2 })),
      peers,
    ),
    0,
  );
  assert.equal(
    connectedQuorumMembers(
      quorum,
      nodes.map((node, i) => ({ ...node, online: i >= 2 })),
      peers,
    ),
    0,
  );
});
test("invalid members and repeated or self peer identities cannot inflate participation", () => {
  const repeated = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      [node.proTxHash, node.proTxHash, "hash3", "hash3"],
    ]),
  );
  assert.equal(connectedQuorumMembers(quorum, nodes, repeated), 0);
  const invalid = {
    ...quorum,
    members: quorum.members.map((member, i) => ({ ...member, valid: i < 2 })),
  };
  assert.equal(connectedQuorumMembers(invalid, nodes, peers), 0);
});

test("DKG ignores nonparticipant candidate peers but requires selected-session authenticated connections", () => {
  const type = "llmq_devnet";
  const candidate = {
    llmqType: type,
    quorumIndex: 0,
    quorumHash: "cycle",
    quorumConnections: [{ connected: false }],
  };
  assert.equal(
    dkgConnectionsReady({ session: [], quorumConnections: [candidate] }, [
      type,
    ]),
    true,
  );
  const session = {
    llmqType: type,
    quorumIndex: 0,
    status: { quorumHash: "cycle", phase: 1 },
  };
  assert.equal(
    dkgConnectionsReady(
      { session: [session], quorumConnections: [candidate] },
      [type],
    ),
    false,
  );
  assert.equal(
    dkgConnectionsReady({ session: [session], quorumConnections: [] }, [type]),
    false,
  );
  assert.equal(
    dkgConnectionsReady(
      {
        session: [session],
        quorumConnections: [
          { ...candidate, quorumConnections: [{ connected: true }] },
        ],
      },
      [type],
    ),
    true,
  );
  assert.equal(
    dkgConnectionsReady(
      {
        session: [session],
        quorumConnections: [
          {
            ...candidate,
            quorumHash: "older",
            quorumConnections: [{ connected: true }],
          },
        ],
      },
      [type],
    ),
    false,
  );
});

test("completed previous rotation sessions do not block the next index boundary", () => {
  const complete = {
    llmqType: "llmq_devnet_dip0024",
    quorumIndex: 1,
    status: { quorumHash: "previous", phase: 6 },
  };
  const pendingIndex = { llmqType: "llmq_devnet_dip0024", quorumIndex: 1 };
  assert.equal(
    dkgConnectionsReady(
      { session: [complete], quorumConnections: [pendingIndex] },
      [complete.llmqType],
    ),
    true,
  );
});
