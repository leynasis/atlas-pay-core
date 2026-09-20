# LAVEPAY — local LAVE payment development

**LAVEPAY** is the payment system. **LAVE** is the native test unit of its new
local development chain. Version 0.4 builds LAVE Core from this repository's
Dash-derived C++ source and runs three nodes on `lave-local-v1`. Merchant invoices,
customer payments and merchant-approved refunds use that selected chain.

This is a development prototype with valueless test coins. It is not a public
mainnet, global payment service, production custody system, or finalized currency
economy. No exchange listing, fiat conversion, domain or trademark availability
is implied.

## Two explicit profiles

| Profile          | Currency  | Core runtime                     | Data                                                               |
| ---------------- | --------- | -------------------------------- | ------------------------------------------------------------------ |
| `lave` (default) | Test LAVE | Locally built LAVE Core          | `.runtime/lave/`                                                   |
| `atlas` (opt-in) | Test DASH | Pinned official Dash Core 23.1.8 | Existing `.runtime/lab/`, `.runtime/merchant/`, `.runtime/signer/` |

The LAVE profile has separate genesis blocks, P2P message bytes and local
address/key encodings. Its [source changes and build](docs/LAVE-CORE.md)
are distinct from a public-chain security review. A different prefix or chain
name alone is not comprehensive transaction replay protection.

`LAVEPAY_NETWORK=atlas` preserves the previous `atlas-local-v1` chain, its units
and data. Existing DASH balances are not LAVE balances. The old single-node
regtest API remains a third, separate legacy experiment on port 4180.

## Start here

See [payments/README.md](payments/README.md) for dependencies and the full walkthrough.

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
does not sign it.

## Upstream baseline

- Project: https://github.com/dashpay/dash
- Release: v23.1.8
- Commit: 728f5055836c6d29806412fc7223ac8fe05af991
- MIT license and notices remain in [COPYING](COPYING).

The initial local checkout is shallow and pinned to that release. Version 0.4
adds a narrowly scoped local devnet client and profile separation. Mainnet
parameters, operator economics, distribution, governance authority, adversarial
validation and an independently reviewed release process remain open work.

The product focus is reliable payment acceptance: invoices, verified settlement
state, transparent fees, explicit refunds and useful recovery. No production
throughput or decentralization claim follows from three processes on one machine.
See [the roadmap](payments/docs/ROADMAP.md), [network specification](payments/docs/NETWORK-SPEC.md)
and [security boundaries](payments/docs/SECURITY.md).
