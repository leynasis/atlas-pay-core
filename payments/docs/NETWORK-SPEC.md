# Atlas local network specification, version 1

This specification describes a reproducible developer network, not proposed
mainnet economics. Authoritative machine-readable constants are in
[`lab/config.mjs`](../lab/config.mjs).

| Property | Local specification |
| --- | --- |
| Network name | `atlas-local-v1` |
| RPC chain identity | `devnet-atlas-local-v1` |
| Runtime baseline | Official Dash Core 23.1.8, pinned SHA-256 |
| Node roles | Miner, merchant, customer signer |
| RPC ports | 19901, 19902, 19903 on 127.0.0.1 |
| P2P ports | 19911, 19912, 19913 on 127.0.0.1 |
| Bootstrap | Explicit local peer links, no DNS or fixed seed discovery |
| Block creation | On-demand developer command; no continuous mining service |
| Easy-mining window | First 10,000 blocks; a lab convenience, not economic security |
| Named-devnet genesis allowance | `highsubsidyblocks=1`, `highsubsidyfactor=1` |
| Quorums / finality services | No masternodes; no InstantSend or ChainLocks |
| Units | Test DASH with no monetary value |

The network's base genesis is
`000008ca1832a4baf228eb1553c03d3a2c8e02399550dd6ea8d65cec3ef23d2e`.
Its identifying block at height one is
`6bf1e63db8f55984d9ddfe93b99f0dd11e5d593c2d7cbdf706c84c11b37827d2`.
Both hashes and the exact RPC chain name must match.

The height-one allowance is needed for this release to accept its own generated
50-DASH named-devnet block. The multiplier remains one; this does not create a
new mainnet issuance policy. Consult [LAB.md](LAB.md) for the observed behavior
and verified bootstrap procedure.

## Deliberately inherited parameters

Consensus, address/key encodings, P2P message magic, governance rules and spork
authority defaults are inherited from Dash devnet. The named block distinguishes
the chain, but test address prefixes and transaction/PSBT formats do not carry
that identity. Never describe this lab as having comprehensive cross-chain
replay protection or independent production governance.

## Decisions required for a public network

Define a new network identity and wallet encoding strategy; audit replay
isolation; choose and secure initial governance/spork authorities; specify
issuance and difficulty together with a sustainable operator budget; define
quorum formation, activation and upgrade rules; choose independently operated
bootstrap nodes; and test recovery and adversarial behavior. Then build and
review the corresponding source changes. None of those choices is finalized
by changing a name or launching these three local processes.
