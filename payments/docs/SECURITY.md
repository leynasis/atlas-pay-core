# Prototype security boundaries — v0.3

This is a loopback development system with valueless test coins. HTTP and RPC services are not ready for internet exposure.

- The default payment flow pins `devnet-atlas-local-v1` and both genesis hashes. The optional legacy API separately requires isolated regtest.
- Merchant RPC credentials are restricted by Dash itself to derivation and required reads. They cannot sign, send, export keys or stop nodes. The node's merchant wallet still contains keys: it is not watch-only.
- Customer payment and merchant refund signing happen in separate role-bound wallet processes with separate durable journals. No private keys or RPC credentials are returned to browsers.
- Wallet POST requests require exact Host/Origin, a role-specific HttpOnly SameSite session cookie and a secret CSRF header. Merchant endpoints have Host/Origin checks but no merchant account authentication.
- Browser navigation and preparation do not authorize a spend. A separate explicit approval must match the concrete transaction fingerprint; source details are fetched again before a fresh signature.
- Money uses bounded decimal strings and integer satoshis. PSBT policy verifies wallet-owned confirmed inputs, the exact recipient, owned change, signature mode and fee ceilings.
- Signed bytes and txid are journaled before broadcast. Lost responses recover the same transaction. Interrupted ambiguous preparation/signing states fail closed for inspection; cancellation is only for unsigned drafts.
- A checksum does not authenticate merchant identity. Merchant names remain unverified. Local source checks do not lock out simultaneous payments from other devices.
- Full confirmed receipts may be refunded to an explicit merchant-selected address through the merchant wallet. Receipt registration independently checks the actual outgoing transaction; extra receipts, conflicts and changed totals require review.
- The local test mining helper uses the miner's administrative transport. Monitoring uses separate restricted credentials on all three nodes. There is no HTTP node-start/stop or generic RPC proxy.
- Block confirmations are not InstantSend or ChainLocks. No quorums are configured.

## Local isolation limitation

Separate processes, wallets and RPC credentials do not protect against a process running as the same operating-system user that can read all runtime files. This is not production custody isolation or a claim of customer-device ownership. Customer wallets must move to separate trusted devices/accounts before public use.

## Runtime data

`.runtime/` contains node wallets, administrator cookies, limited credentials, binaries, invoices and signing journals including signed raw transactions. It is excluded from Git. Never publish or copy it into a deliverable. Test keys remain secrets despite having no monetary value.

## Before production

Define custody and recovery, authenticate merchants and signed payment requests, use public invoice capabilities, isolate signers, add rate limits and replay-safe webhooks, remove development mining, implement secure deployment and observability, and obtain independent security review. Distributed network and fiat/payment operations are separate milestones in [ROADMAP.md](ROADMAP.md).
