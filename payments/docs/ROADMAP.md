# LAVEPAY delivery roadmap

This document separates implemented prototype scope from future work. No dates,
transaction-rate claims or worldwide coverage are promised without evidence.

## Implemented foundation — local payments and native chain

The original regtest prototype introduced persistent invoices, decimal-safe
amounts, addresses, QR checkout, real test payments and separate refunds. The
named-devnet application added independent wallet approval, PSBT review,
immutable requests, durable broadcast retry and independently checked receipts.

Version 0.4 added source-built LAVE Core, separate `lave-local-v1` genesis blocks,
P2P bytes and local address/key encodings, plus explicit currency binding. The
Dash-backed Atlas profile retains its original chain, balances and request
checksums. Name, domain and trademark availability remain unverified.

## Implemented in v0.5 — cashier and recovery boundaries

- Four LAVE payment nodes: miner, actual watch-only cashier, customer signer and separate merchant refund signer.
- Restart-safe migration preserving original LAVE addresses, invoice ledger and private merchant wallet; public descriptors and labels remain at the cashier.
- macOS Seatbelt confinement for the cashier, with method-restricted receiving, monitoring and development-mining credentials.
- Password-encrypted Core-wallet and signing-journal exports, plus CLI extraction into a new directory with new signatures blocked.
- A separate nine-node LAVE-Q lab with eight local masternodes, used to validate inherited quorum behavior independently of the payment chain.

The payment chain still has no active InstantSend or ChainLocks. See
[MASTERNODES.md](MASTERNODES.md) for the separate experiment's exact evidence and
[VALIDATION-V05.md](VALIDATION-V05.md) for v0.5 checks. Local processes under one
host owner are not independent operators or customer-controlled custody.

## Next payment milestone — authenticated use and deliberate recovery

Authenticate merchant accounts and wallet owners. Bind signed expiring invoices
to verified merchant identities; the current request hash is only a checksum.
Add scoped public read-only checkout capabilities, rate limits, replay-safe
webhooks and audit records. Keep private invoice metadata out of public chain
storage.

Move customer signing to trusted customer devices or a reviewed hardware-wallet
integration. Isolate merchant signing beyond the cashier's macOS sandbox, and
provide equivalent enforced deployment boundaries on supported platforms.
Keep fresh signatures blocked for recovered snapshots until later payments,
UTXOs and journal state have been reconciled through a reviewed recovery
procedure. Back up merchant accounting and operator keys separately from the
existing signing-wallet export.

Acceptance requires an end-to-end payment/refund with authenticated principals,
rejection of forged merchant requests and cross-account access, preserved exact
transaction retries after interruption, and a documented recovery rehearsal
that cannot silently create a second spend from an older snapshot.

## Distributed testnet and operational evidence

The local lab covers block relay, restart/catch-up and partition/convergence.
The LAVE-Q experiment adds actual local masternode and quorum testing, but uses
a separate chain and one machine. Recruit independent operators and validate
network diversity before calling either system a distributed public testnet.

Finalize intended payment markets, threat model, issuance, sustainable operator
budget and initial distribution. Review genesis, discovery, replay isolation,
difficulty, quorum activation, governance authority and upgrade schedules
together; block-based schedules affect issuance and quorum timing.

Measure p50/p95/p99 acceptance latency, confirmed throughput, quorum availability,
ChainLocks lag, mempool behavior, node cost and state growth. Exercise operator
loss, partitions, conflicts, fees, reorganization, interrupted upgrades and
restored backups. Compare equivalent hardware/load with stock Dash. Reproduce
release binaries independently and commission review of consensus and custody
changes. Mainnet requires published evidence, incident response, supported
releases and an accountable launch decision.

## International payment operations

Crypto settlement, fiat conversion and merchant payouts are separate
capabilities. A new coin does not create liquidity or stable purchasing power.
Identify initial markets, settlement assets, conversion partners, payout paths
and responsibility for disputes. Validate market-specific requirements with
appropriate partners before live rollout. No bank, conversion provider,
stablecoin issuer or licensed payment service is integrated in this prototype.

Name registration, public-chain economics, operator onboarding, market scope,
production custody and settlement partnerships remain open decisions. No user
funds should depend on provisional choices.
