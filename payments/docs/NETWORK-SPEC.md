# LAVEPAY local network profiles — v0.5

This is a developer-network specification, not mainnet economics. The default
`lave` profile runs LAVE Core built from this repository. The explicit `atlas`
profile retains the original Dash development chain and all existing data.
Authoritative constants are in [`lab/profiles.mjs`](../lab/profiles.mjs) and
[`lab/config.mjs`](../lab/config.mjs); the native diff is described in
[LAVE-CORE.md](../../docs/LAVE-CORE.md).

| Property             | LAVE (default)                                     | Atlas (`LAVEPAY_NETWORK=atlas`)           |
| -------------------- | -------------------------------------------------- | ----------------------------------------- |
| Currency             | Test LAVE                                          | Test DASH                                 |
| Network name         | `lave-local-v1`                                    | `atlas-local-v1`                          |
| RPC chain            | `devnet-lave-local-v1`                             | `devnet-atlas-local-v1`                   |
| Runtime              | Locally compiled LAVE Core                         | Official Dash Core 23.1.8, pinned SHA-256 |
| RPC ports            | 20001, 20002, 20003, 20004                         | 19901, 19902, 19903                       |
| P2P ports            | 20011, 20012, 20013, 20014                         | 19911, 19912, 19913                       |
| State root           | `.runtime/lave/`                                   | Existing `.runtime/` subdirectories       |
| Role wallets         | Miner, watch-only cashier, customer, refund signer | Existing miner, merchant, customer        |
| Address/key encoding | Separate local LAVE prefixes                       | Original Dash test prefixes               |

Every listener is bound to `127.0.0.1`. The applications use HTTP ports
4173/4174/4175 for either profile: stop them before changing profiles. Chain
state, invoice ledgers and signing journals do not migrate between profiles.
LAVE requests bind `network.currency: "LAVE"`; old Atlas request identities keep
their original shape and checksums. Currency on views is derived from the
original request/profile, not the current product brand.

## Pinned chain identity

| Block                        | LAVE                                                               | Atlas                                                              |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Genesis, height 0            | `28fae923c5ef15cb623f14f61aae383050712a8ef7ff740bb2b1541d8a3bcf9c` | `000008ca1832a4baf228eb1553c03d3a2c8e02399550dd6ea8d65cec3ef23d2e` |
| Named-devnet block, height 1 | `2043af4ec0030900338e8ad5eb86428008787d4be468f197d2bcd1776c094209` | `6bf1e63db8f55984d9ddfe93b99f0dd11e5d593c2d7cbdf706c84c11b37827d2` |

All monetary operations require the exact chain name and both pinned hashes.
The LAVE devnet changes its P2P message bytes and local address/key encodings in
addition to its genesis. These local encodings are not globally allocated coin
identifiers. Separate encoding and genesis are not a general cryptographic
cross-chain replay-protection claim; transaction and PSBT structures remain
inherited from Dash.

## Laboratory bootstrap

There are four LAVE loopback processes (three for Atlas), explicit local peer
links, no DNS/fixed seed discovery, and no continuous mining service. Developer commands create blocks
on demand. The first 10,000 blocks use easy mining. The height-one allowance is
`highsubsidyblocks=1` with `highsubsidyfactor=1`; this permits the built-in
50-unit devnet block without multiplying subsequent rewards. Its OP_RETURN
output is unspendable. These are bootstrap conveniences, not a proposed public
issuance policy. See [LAB.md](LAB.md).

The payment lab does not configure masternodes, quorum finality, InstantSend or
ChainLocks. A shared tip shows synchronization of local processes, not independent
operators or economic security. Test coins have no monetary value.

## v0.5 custody layout

The merchant node on RPC20002 holds a descriptor wallet named `cashier` with
`private_keys_enabled=false`. Its private merchant wallet is preserved on the
separate `signer` node, RPC20004, for refund approval. Customer signing stays on
RPC20003. This is a same-chain wallet migration: existing LAVE receiving
addresses, invoice records and request identities remain unchanged. It does
not alter either genesis or convert Atlas data. See [LAB.md](LAB.md).

## Separate quorum laboratory

[LAVE-Q](MASTERNODES.md) runs `devnet-lave-quorum-v1` with different genesis
blocks, network bytes, ports and data in `.runtime/masternodes/`. It has nine
local nodes: one controller and eight masternodes. Its RPC ports are 20101–20109
and P2P ports 20111–20119. The payment profile selector remains exactly `lave`
or `atlas`; LAVE-Q is managed through separate `mn:*` commands.

LAVE-Q results are recorded against that chain's identity. Its balances are not
LAVE payment balances, and successful quorum tests there do not enable
InstantSend or ChainLocks for merchant invoices.

## Work required for a public network

Finalize issuance, difficulty and sustainable operator economics; independently
review source changes and replay isolation; choose and secure governance/spork
authorities; specify quorum activation and upgrades; recruit independent
operators; validate backups, recovery and adversarial behavior; and establish a
supported release process. None of those steps is completed merely by building
LAVE Core or choosing a ticker.
