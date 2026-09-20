// Local RPC reachability does not establish participation in quorum signing.
export function connectedQuorumMembers(quorum, nodes, authenticatedPeers) {
  const valid = new Set(
    quorum.members
      .filter((member) => member.valid)
      .map((member) => member.proTxHash),
  );
  const eligible = nodes.filter(
    (node) =>
      node.online === true &&
      node.synchronized === true &&
      node.state === "READY" &&
      node.peerCount > 0 &&
      valid.has(node.proTxHash),
  );
  const hashes = new Set(eligible.map((node) => node.proTxHash));
  return eligible.filter((node) => {
    const connected = new Set(
      (authenticatedPeers[node.id] || []).filter(
        (hash) => hash !== node.proTxHash && hashes.has(hash),
      ),
    );
    return connected.size >= quorum.threshold - 1;
  }).length;
}

export function dkgConnectionsReady(status, types) {
  return (status.session || [])
    .filter(
      (session) =>
        types.includes(session.llmqType) &&
        session.status?.phase >= 1 &&
        session.status.phase <= 5,
    )
    .every((session) => {
      const quorum = (status.quorumConnections || []).find(
        (candidate) =>
          candidate.llmqType === session.llmqType &&
          candidate.quorumIndex === session.quorumIndex &&
          (!session.status?.quorumHash ||
            candidate.quorumHash === session.status.quorumHash),
      );
      return (
        Array.isArray(quorum?.quorumConnections) &&
        quorum.quorumConnections.every((peer) => peer.connected === true)
      );
    });
}
