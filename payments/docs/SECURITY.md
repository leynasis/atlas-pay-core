# Prototype security boundaries

The payment application is a local development tool with test funds. Do not expose its HTTP or RPC ports to a network or tunnel them to the internet. The local test controls deliberately spend from dedicated regtest wallets.

## Boundaries

- Dash RPC is bound to loopback and authenticated through a runtime cookie.
- A dedicated, ignored runtime data directory avoids the user's normal Dash wallets.
- Payment API monetary operations check the chain is isolated `regtest`; production chains must fail closed. Separate lab CLI operations require the exact `devnet-atlas-local-v1` chain name and both pinned genesis hashes.
- Private keys and RPC credentials remain in the local node and are not returned to the browser.
- Host/Origin checks reduce cross-site requests to the local server. These are not merchant authentication or a production access-control system.
- Amounts enter as bounded decimal strings and are tracked in integer satoshis.
- Mutation idempotency and durable operation records are designed to prevent duplicate payments on repeated clicks/retries. Uncertain transaction broadcasts require reconciliation rather than blind retry.
- A refund is a new transaction. It never reverses or deletes a confirmed payment.
- Status is obtained from the running node. The prototype has no masternode quorums and must not label block confirmation as InstantSend or ChainLocks.
- Lab monitoring uses a separate daemon-enforced RPC method whitelist. The web API exposes no lab spend, sign, mine or lifecycle action.
- The customer CLI constructs and validates a PSBT, checks actual wallet ownership and fees, and requires transaction-specific terminal approval. Requests have a checksum, not authenticated merchant identity.
- Separate lab node wallets do not establish isolation against another process with the same OS user's filesystem access. Customer signing on a separate device/account remains a production requirement.

## Runtime data

`payments/.runtime/` contains test-wallet data, the RPC cookie, downloaded binaries and invoice state. It is excluded from Git. Never copy this directory into a public artifact or commit it. Test keys are still secrets even though these coins have no monetary value.

This also includes lab administrator cookies, limited monitoring credentials,
bootstrap journals and the customer's signing journal. Signed raw transactions
are stored durably before broadcast so uncertain outcomes never trigger a new
payment. Ambiguous preparation/signing states fail closed for manual inspection.

## Before production

Replace local spending controls with customer/merchant-controlled signing, define custody and recovery, authenticate merchant operations, harden request validation/rate limits, implement public invoice capability boundaries, remove demo controls, establish secure deployment and observability, verify transaction reconciliation under reorganizations, and obtain independent security review. See ROADMAP.md for independent-network requirements.
