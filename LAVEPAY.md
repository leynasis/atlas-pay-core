# LAVEPAY — local LAVE payment development

**LAVEPAY** is the payment system. **LAVE** is the native test unit of its local
`lave-local-v1` chain. Version 0.6 keeps four source-built LAVE Core base nodes: miner,
watch-only cashier, customer signer and merchant refund signer. Existing LAVE
invoice addresses and history survive the migration to the watch-only cashier.
Wallets additionally manage a local masternode with reviewed collateral and
registration transactions, persistent reservations and explicit retirement.
Sixteen local seed masternodes bootstrap this payment chain's retained quorums.

This is a development prototype with valueless test coins. It is not a public
mainnet, global payment service, production custody system, or finalized currency
economy. No exchange listing, fiat conversion, domain or trademark availability
is implied.

## Payment profiles and separate quorum laboratory

| Profile          | Currency  | Core runtime                                           | Data                                                               |
| ---------------- | --------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `lave` (default) | Test LAVE | Locally built LAVE Core, four nodes                    | `.runtime/lave/`                                                   |
| `atlas` (opt-in) | Test DASH | Pinned official Dash Core 23.1.8, original three nodes | Existing `.runtime/lab/`, `.runtime/merchant/`, `.runtime/signer/` |

The LAVE profile has separate genesis blocks, P2P message bytes and local
address/key encodings. Its [source changes and build](docs/LAVE-CORE.md) are
distinct from a public-chain security review. A different prefix or chain name
alone is not comprehensive transaction replay protection.

`LAVEPAY_NETWORK=atlas` retains the previous `atlas-local-v1` chain, its units
and data. Existing DASH balances are not LAVE balances. The old single-node
regtest API remains a third, separate legacy experiment on port 4180.

The [LAVE-Q laboratory](payments/docs/MASTERNODES.md) uses a different named
chain, genesis, ports and state, with one controller and eight masternodes.
It is not a selectable payment profile and its valueless LAVE-Q units are not
LAVE payment balances. Payment-chain capability flags now come from its own
fresh [quorum evidence](payments/docs/PAYMENT-MASTERNODES.md).

## Start here

See [payments/README.md](payments/README.md) for dependencies and the walkthrough.

```sh
cd payments
npm ci
npm run core:build
npm run lab:start
npm run core:verify
npm run build
npm start
```

Open http://127.0.0.1:4173. The customer and merchant wallets run on 4174 and 4175. Wallet approval is explicit; opening a link or preparing a transaction
does not sign it. On macOS, `npm start` and `npm run start:merchant` confine the
cashier with Seatbelt. Other systems require the explicit local-demo opt-out
`LAVEPAY_ISOLATION=off`; wallet services remain trusted and unsandboxed.

Both signing wallets can export a password-encrypted Core wallet plus signing
journal. CLI recovery writes to a new directory and blocks new signatures in
the recovered journal: a historical snapshot cannot account for later payments.
See [wallet recovery](payments/docs/WALLET.md) for the exact scope.

## Upstream baseline

- Project: https://github.com/dashpay/dash
- Release: v23.1.8
- Commit: 728f5055836c6d29806412fc7223ac8fe05af991
- MIT license and notices remain in [COPYING](COPYING).

The initial checkout is shallow and pinned to that release. Version 0.4 added
the local LAVE client and profile separation; v0.5 adds custody boundaries and
the separate quorum experiment. Build manifests record local provenance, not
independently reproduced release binaries. Public network parameters, operator
economics, distribution, governance, adversarial validation and an independently
reviewed release process remain open work.

The product focus is reliable payment acceptance: invoices, verified settlement
state, transparent fees, explicit refunds and useful recovery. No production
throughput or decentralization claim follows from processes on one machine.
See [the roadmap](payments/docs/ROADMAP.md), [network specification](payments/docs/NETWORK-SPEC.md)
and [security boundaries](payments/docs/SECURITY.md).
