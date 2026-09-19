# Delivery roadmap

This document separates implemented prototype scope from future work. No dates, transaction-rate claims or worldwide coverage are promised without evidence.

## Milestone 1 — Local payments (this repository)

- Isolated Dash regtest node, separate merchant and test payer wallets.
- Persistent invoices, decimal-safe amounts, real payment addresses and QR checkout.
- Actual test transactions, independently requested block confirmation, and explicit separate refund transactions.
- Merchant dashboard and English/Russian interface.
- Unit tests and an integration test that checks transaction IDs and on-chain wallet receipts.

Completion criteria: reproduce invoice → payment → confirmation → refund with a fresh data directory; reject non-regtest execution; preserve state across restart. A single-node regtest does not demonstrate InstantSend, ChainLocks, decentralization, production throughput or adversarial resilience.

## Milestone 2 — Independent network specification

Decide name/ticker, intended payment market, threat model, sustainable operator budget and initial distribution. Specify network identifiers, genesis, seed bootstrap, address formats, replay isolation, difficulty rules, quorum formation and activation heights. Review all changes together: block-based schedules affect issuance and quorum timing.

Build the fork from source and validate independent nodes against identical genesis/configuration. Publish a reproducible build recipe and the exact upstream diff. Test wallet/network separation and recovery. Recruit independent operators before claiming decentralization.

## Milestone 3 — Non-custodial payment integration

Use customer-controlled signing and merchant watch-only infrastructure. Design wallet backup/recovery and hardware signing integration. Add authenticated merchant accounts, public read-only invoice capabilities, signed expiring payment requests, webhooks with replay protection and idempotency, rate limits, audit records, and merchant-directed refunds. Keep private invoice metadata out of public chain storage.

Choose whether Dash Platform identities and proofs justify operating the additional stack. Names and data contracts already exist upstream and should be integrated instead of advertised as newly invented features.

## Milestone 4 — Distributed testnet and operational evidence

Measure p50/p95/p99 payment acceptance, actual confirmed throughput, quorum availability, ChainLocks lag, mempool behavior, full-node cost and state growth. Exercise network partitions, operator loss, conflicting transactions, insufficient fee, reorganization, overdue and overpaid invoices, interrupted upgrades and restored backups. Compare the same load and hardware with stock Dash.

Commission independent review of modified consensus and custody/signing boundaries. Publish limitations, recovery procedures, monitoring and an incident response process. Mainnet requires these results, a supported release process and an accountable launch decision.

## Milestone 5 — International payment operations

Crypto settlement, fiat conversion and merchant payouts are separate capabilities. A new coin does not automatically provide exchange liquidity or stable purchasing power. Identify initial markets, settlement assets, conversion partners, payout paths and responsibility for fraud/disputes. Validate applicable requirements per market with appropriate partners before live rollout. No conversion provider, bank, stablecoin issuer or licensed service is integrated in this prototype.

## Decisions intentionally still open

Brand and ticker; coin economics; distribution; public-chain launch; operator onboarding; market/jurisdiction scope; custody model; fiat and stable-value settlement partners. No user funds should depend on provisional choices.
