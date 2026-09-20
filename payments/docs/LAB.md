# LAVEPAY three-node development lab — v0.4

The lab runs three role-specific processes with separate wallets on **one
computer**. The default LAVE profile uses a locally compiled LAVE Core client
and the distinct `lave-local-v1` chain. The explicit Atlas profile retains its
original official Dash binary, `atlas-local-v1` history and test-DASH balances.
Both are valueless local experiments, not public networks or evidence of
independent operators. No masternode quorums, InstantSend or ChainLocks run here.

## Run

From `payments/`, after installing npm and native build dependencies:

```sh
npm run core:build
npm run lab:start
npm run lab:status
npm run lab:mine -- 1
npm run lab:stop
```

See [LAVE-CORE.md](../../docs/LAVE-CORE.md) for the native build toolchain and source changes.
`lab:start` requires the compiled LAVE binary for the default profile; it never
silently substitutes official Dash. Startup verifies identity, connects the
three nodes, loads their role wallets and supplies test funds when needed.
Mining accepts 1–110 blocks and waits for synchronization. Stop preserves data.

To use the old chain, prefix **every applicable command**, including application
startup, with `LAVEPAY_NETWORK=atlas`. For example:

```sh
LAVEPAY_NETWORK=atlas npm run lab:start
LAVEPAY_NETWORK=atlas npm run lab:status
LAVEPAY_NETWORK=atlas npm start
```

Atlas can install the checksum-pinned official Dash Core binary when missing.
Do not run both application profiles on the same 4173/4174/4175 HTTP ports.
The optional old regtest API on 4180 has its own data and is not migrated.

## Identity and state isolation

The [network specification](NETWORK-SPEC.md) records both exact chain names and
both hashes per profile. Generic `devnet`, a currency label or an address prefix
is insufficient. LAVE uses separate base genesis, named-devnet genesis, P2P
message bytes and local address/key encodings; Atlas retains the original Dash
parameters. No comprehensive cross-chain replay-protection claim is made.

| Role       | LAVE RPC / P2P | Atlas RPC / P2P |
| ---------- | -------------- | --------------- |
| `miner`    | 20001 / 20011  | 19901 / 19911   |
| `merchant` | 20002 / 20012  | 19902 / 19912   |
| `customer` | 20003 / 20013  | 19903 / 19913   |

All addresses are `127.0.0.1`. LAVE datadirs are
`.runtime/lave/lab/<node-id>/`; Atlas keeps `.runtime/lab/<node-id>/`.
Each administrator cookie lives under that node's exact named-chain directory.
Invoice ledgers and signing journals are also profile-specific. Existing DASH
coins and invoices are never relabeled LAVE or copied into the new chain.

## Peer and credential boundaries

P2P is enabled, but DNS, fixed seeds, discovery, Tor listeners, port mapping and
automatic connections are disabled. Startup establishes an explicit triangle
of local peers. Guards verify exact chain identity, loopback peer addresses,
fixed outbound ports and the advertised named devnet. A genuinely unfinished
peer handshake can be retried within a bounded connection window; a wrong
nonempty identity is rejected immediately. Peer advertisements are not
cryptographic operator authentication. Incoming ephemeral ports may have no
mapped node ID in the dashboard.

Dashboard credentials in the selected lab's `dashboard/` directory permit only
`getblockchaininfo`, `getnetworkinfo`, `getpeerinfo` and `getblockhash`. Merchant
API credentials permit address derivation and necessary transaction reads;
they cannot sign, send, export keys or stop nodes. See [MERCHANT.md](MERCHANT.md).
Separate wallet services perform customer and merchant signing. The explicit
development mining helper uses only the miner administrator cookie.

Administrative CLI tools use cookie authentication. `rpcwhitelistdefault=0`
preserves cookie administration while explicit dashboard/API users remain
restricted. All processes still share one OS user: that user can read the files
of other roles. This is an application boundary, not production key isolation.

## Bootstrap and recovery

Both profiles use an easy-mining window of 10,000 blocks, a height-one subsidy
allowance of one block, and multiplier one. In the original Dash 23.1.8 Atlas
bootstrap, default `highsubsidyblocks=0` rejected the built-in 50-DASH block one
against a 5-DASH limit (`bad-cb-amount`). The pinned allowance fixes that local
bootstrap issue. LAVE pins the corresponding lab values in its native profile.
This does not finalize public token economics.

Startup funds the customer with 20 test units when trusted plus pending funds
are below 5, and the merchant with 2 when below 1. It mines maturity blocks only
if funding is actually needed and the miner lacks the amount plus fee reserve.
An already funded repeat start does not add blocks. Units are LAVE for the LAVE
profile and DASH for Atlas.

The selected lab directory holds `manifest.json` and a durable `funding.json`
journal. An uncertain send refuses blind retry: inspect the miner transaction
comment and recipient wallet before resolving it. Wallets are unencrypted test
fixtures; never use their keys for real funds. All runtime data is ignored by Git.

## Verification and module contracts

`lab/config.mjs` selects a strict profile; unknown values fail. `lab/rpc.mjs`
preserves exact decimal values and provides administrative, merchant-limited
and dashboard transports. Administrative callers check `assertLabNode` before
writes. `getLabStatus` uses only monitoring credentials and calls nodes
synchronized only when all three verified heights and tips agree.

```sh
npm test
npm run test:lab
npm run test:signer
npm run test:integration
```

Run integration suites serially: they create test transactions and blocks and
may stop or partition nodes. The lab test also checks isolation from existing
legacy environments. The application flow test requires all three HTTP apps.
Reports are under the selected runtime root; consult [VALIDATION.md](VALIDATION.md)
for recorded runs rather than assuming every historical test report applies to
the new binary. Throughput, adversarial resilience and public launch readiness
remain unproven.
