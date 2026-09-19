# Prototype validation

Validated on 20 September 2026 (Asia/Baku), macOS ARM64, Node.js 25.6.1,
using the checksum-verified official Dash Core 23.1.8 binary. All coin
movements used an isolated local regtest chain and valueless test coins.

## Automated checks

- `npm test`: 12 tests passed. Coverage includes exact decimal amounts,
  persisted idempotency, uncertain RPC outcomes across restarts, partial and
  excess payments, expiry (including overdue partial payments), late receipts,
  reorganizations, refund exceptions, network isolation and HTTP boundaries.
- `npm run test:integration`: 13 checks passed against a running Dash node.
  These verify actual wallet transactions, confirmations, a distinct refund
  transaction received by the payer, partial and excess payments, block
  invalidation/reconsideration, and additional funds arriving after a refund.
- `npm run build` and `npm run check:format`: passed.
- `npm audit`: reported no known dependency vulnerabilities at validation time.

The live integration script writes its local report to
`.runtime/integration-report.json`; the report and wallet data are excluded
from Git. It intentionally leaves test invoices and transactions for inspection.

## Browser and lifecycle checks

- Created an invoice, opened its payment page, sent test coins, confirmed the
  payment, issued a refund and confirmed the refund through the interface.
- Checked the merchant workspace and checkout at desktop and 390-pixel mobile
  width, with no document-level horizontal overflow.
- Checked Russian and English UI, QR display, persisted invoice state after an
  API restart, and a prominent review warning for post-refund incoming funds.
- Observed no browser console warnings or errors in the final desktop check.
- Stopped and restarted the local node; wallets and chain data persisted.

## Scope of evidence

This is application-level validation, not an independent security audit.
The modified C++ client has not been built: no C++ consensus changes were made.
Dash's full C++ and functional test suites were not run. No distributed network,
masternode quorum, InstantSend, ChainLocks, throughput benchmark, real custody,
fiat integration or public deployment was tested.

The upstream lint runner is also invoked with an explicit `COMMIT_RANGE` because
the initial local checkout is shallow. Its optional codespell, vulture, cppcheck,
flake8 and shellcheck checks are skipped when those tools are unavailable.
