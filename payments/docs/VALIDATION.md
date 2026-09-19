# Prototype validation

Validated on 20 September 2026 (Asia/Baku), macOS ARM64, Node.js 25.6.1,
using the checksum-verified official Dash Core 23.1.8 binary. All coin
movements used local test chains and valueless test coins.

## Automated checks

- `npm test`: 27 tests passed for version 0.2.0. Coverage includes exact decimal amounts,
  persisted idempotency, uncertain RPC outcomes across restarts, partial and
  excess payments, expiry (including overdue partial payments), late receipts,
  reorganizations, refund exceptions, network identity/isolation, restricted
  monitoring, HTTP boundaries, PSBT policy, explicit approval, signing recovery,
  cancellation and live confirmation status.
- `npm run test:lab`: 8 checks passed against three actual named-devnet nodes,
  including fixed chain identity/subsidy, daemon-enforced read-only credentials,
  role-wallet separation, repeat startup, block relay, restart/catch-up and
  convergence after a partition with competing branches. The original regtest
  tip remained unchanged throughout these checks.
- `npm run test:signer`: 8 checks passed using actual PSBTs and devnet wallet
  transactions. These include tampered requests/outputs/fees, declined approval,
  a real broadcast with simulated lost response, SQLite restart reconciliation,
  merchant receipt and unsigned reservation cancellation.
- The first milestone's `npm run test:integration` passed 13 regtest checks.
  These verify actual wallet transactions, confirmations, a distinct refund
  transaction received by the payer, partial and excess payments, block
  invalidation/reconsideration, and additional funds arriving after a refund.
- `npm run build` and `npm run check:format`: passed.
- `npm audit`: reported no known dependency vulnerabilities at validation time.

Reports live in `.runtime/integration-report.json`,
`.runtime/lab/integration-report.json` and
`.runtime/signer/integration-report.json`. Reports and wallet data are excluded
from Git. The checks leave test invoices and transactions for inspection.
Lab lifecycle and signer integration tests must run serially.

## Browser and lifecycle checks

- Created an invoice, opened its payment page, sent test coins, confirmed the
  payment, issued a refund and confirmed the refund through the interface.
- Checked the merchant workspace and checkout at desktop and 390-pixel mobile
  width, with no document-level horizontal overflow.
- Checked Russian and English UI, QR display, persisted invoice state after an
  API restart, and a prominent review warning for post-refund incoming funds.
- Observed no browser console warnings or errors in the final desktop check.
- Stopped and restarted the local node; wallets and chain data persisted.
- Checked the new Network page in Russian and English, including 390-pixel
  width, peer details and navigation back to the separate regtest dashboard.
- Stopped the merchant devnet node: the page showed 2/3 available and no common
  tip. After restart and reconnection it returned to 3/3 synchronized nodes.
- Independently exercised the actual interactive signing CLI, including typed
  transaction-specific approval. The merchant received exactly 0.125 test DASH;
  the fee was 0.00000225. Live signer status reported one confirmation.
- The first manually mined block preceded transaction relay and did not include
  that CLI payment. After the transaction reached the miner's mempool, a later
  block confirmed it. Broadcast and confirmation are intentionally separate.

## Scope of evidence

This is application-level validation, not an independent security audit.
No fork-specific C++ client has been built; no C++ consensus source changes were made.
Dash's full C++ and functional test suites were not run. No independently operated network,
masternode quorum, InstantSend, ChainLocks, throughput benchmark, real custody,
fiat integration or public deployment was tested.

The upstream lint runner is also invoked with an explicit `COMMIT_RANGE` because
the initial local checkout is shallow. Its optional codespell, vulture, cppcheck,
flake8 and shellcheck checks are skipped when those tools are unavailable.
