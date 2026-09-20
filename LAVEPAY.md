# LAVEPAY — LAVE payment network development

**LAVEPAY** is the payment system; **LAVE** is the selected name of its planned native currency. The project is an early payment-system fork of Dash Core. Version 0.3 connects a merchant workspace and checkout to the three-node `atlas-local-v1` devnet. Separate browser wallets prepare, review and explicitly sign customer payments and merchant refunds. The original isolated regtest prototype remains available as a legacy API with separate data.

**Status:** development prototype. It is not a public mainnet, a live global payment service, a new issued asset, or a production custody system. The original Dash consensus has not been modified. The runtime uses the verified official Dash Core binary matching the source baseline.

The named devnet uses explicit developer configuration described in
[NETWORK-SPEC.md](payments/docs/NETWORK-SPEC.md). It is a distinct local chain
using Dash's existing devnet mechanism, not a separately compiled mainnet client.

## Brand and runtime

The names LAVE and LAVEPAY replace the earlier working brand Atlas Pay. The
current runtime continues to use valueless test DASH, the existing
`atlas-local-v1` chain identity, and its pinned genesis hashes. Existing wallets,
invoices and transactions remain on that same chain. This naming decision does
not create or issue LAVE, define its economics, or establish a public network.
Domain, ticker-market and trademark availability have not been verified.

## Start here

See [payments/README.md](payments/README.md) for setup, commands, capabilities and limitations.

```sh
cd payments
npm ci
npm run demo
```

Open http://127.0.0.1:4173 after startup.

## Upstream baseline

- Project: https://github.com/dashpay/dash
- Release: v23.1.8
- Commit: 728f5055836c6d29806412fc7223ac8fe05af991
- Upstream MIT license and notices remain in [COPYING](COPYING).
- Application work is isolated in `payments/` to make upstream security updates easier to review and merge.

The GitHub repository is a fork of Dash Core; the initial local checkout is shallow and pinned to the release commit above. Creating a distinct public blockchain with a new genesis, identifier, emission schedule and independent operators is a later milestone, not something claimed by this prototype.

## Product direction

Build reliable payment acceptance: invoices, verified settlement status, transparent fees, explicit refunds, clear recovery, and useful merchant integrations. Technical targets must be measured against the unmodified baseline before changing consensus.

See [the delivery roadmap](payments/docs/ROADMAP.md) and [security boundaries](payments/docs/SECURITY.md).
