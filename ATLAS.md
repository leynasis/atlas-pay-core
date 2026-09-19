# Atlas Pay — Dash payment network development

Atlas Pay is a working name for an early payment-system fork of Dash Core. The first deliverable is a real local payment flow on an isolated **regtest blockchain**, with a merchant workspace and customer checkout.

**Status:** development prototype. It is not a public mainnet, a live global payment service, a new issued asset, or a production custody system. The original Dash consensus has not been modified. The runtime uses the verified official Dash Core binary matching the source baseline.

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
