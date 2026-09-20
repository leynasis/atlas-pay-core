# Prototype validation — v0.3

Validated on 20 September 2026 (Asia/Baku), macOS ARM64, Node.js 25.6.1, with the checksum-verified official Dash Core 23.1.8 runtime. All transfers used local chains and valueless test coins.

## Automated checks

- `npm test`: 45 application unit and HTTP tests passed. They cover decimal amounts, persistence, idempotency, network identity, PSBT policy, explicit approval, partial/late/excess payments, reorgs, refund proof and recovery. The v0.3 additions exercise role-specific HTTP sessions/CSRF, stale request rejection, receipt retries after transient errors or interrupted journals, dropped/refound refunds and unconfirmed change accounting. Three regressions cover the peer-handshake wait and strict rejection of invalid peers.
- `npm run test:integration`: 11 grouped live checks connect all three apps to devnet. They verify the daemon itself rejects merchant signing/sending/key export, create an immutable invoice, enforce HTTP/role/fingerprint boundaries, explicitly sign a customer payment, confirm the receipt, restore a fresh session, create and sign a distinct full refund, verify actual customer receipt, replay without another transaction, cancel an unsigned request and reject approval after an external partial payment.
- `npm run test:signer`: 8 live checks passed, including actual PSBT tampering, declined approval, a real broadcast with a simulated lost response, SQLite restart recovery, exact merchant receipt and unsigned reservation cancellation.
- `npm run test:lab`: all 8 live checks passed for three-node identity/subsidy, daemon-enforced limited monitoring, wallet separation, repeat startup, block relay, restart/catch-up and partition/rejoin checks. A reconnect run exposed an unfinished peer-handshake race; the lifecycle wait was corrected without relaxing monetary-operation identity checks.
- The first milestone passed 13 legacy regtest checks. These remain available as `npm run test:legacy` against API port 4180; they are distinct from the v0.3 devnet checkout suite.
- Production frontend build and formatting checks passed. `npm audit` reported no known dependency vulnerabilities at validation time.
- The upstream lint runner was invoked with `COMMIT_RANGE=HEAD` for the shallow checkout. Optional codespell, vulture, cppcheck, flake8 and shellcheck checks were skipped because those tools are absent.

Live reports are stored under ignored `.runtime/` directories (`checkout-integration-report.json`, `lab/integration-report.json`, `signer/integration-report.json`). Tests leave test invoices/transactions for inspection. Network-mutating integration suites must run serially.

## Browser and restart checks

- Created a 0.05 test-DASH invoice through the merchant interface, opened checkout and moved to the separate customer wallet. Preparation showed the exact recipient, amount, fee of 0.00000225, total, change and pinned network. An explicit button signed and sent it.
- The merchant detected the actual payment; the invoice's test-block action confirmed it. An explicit customer receiving address was then entered for the refund. The separate merchant wallet reviewed and signed a new transaction. The invoice showed the refund confirmed after another test block.
- The browser payment txid was `6fd7c367ffdeb5880218b7739d3117f0015159281e7173820ac7e7807e5acabc`; its separate refund was `184951805965c139d97a97e6cb306c7c8b95de6baafc56160d82581329dfab50`.
- Reloading the customer wallet restored the existing request and confirmed transaction without any new signature. Restarting all three app processes preserved the refunded invoice and the original customer transaction.
- Checked Russian and English checkout/wallet text, QR display, desktop layout, and 390-pixel wallet/checkout/merchant layouts. No document-level horizontal overflow was observed. The final checked browser console had no warnings or errors.
- Independent code review found and fixed receipt-retry key poisoning, missing recovery UI for interrupted broadcasting, stale status for an evicted refund and omitted unconfirmed change. Regression tests cover the server cases; retry remains an explicit same-transaction action.

## Scope of evidence

This is application-level validation, not an independent security audit. No fork-specific C++ client has been built and no C++ consensus changes were made. Dash's full C++/functional test suites were not run. There is no independently operated network, masternode quorum, InstantSend, ChainLocks, throughput benchmark, production custody, fiat integration or public deployment in this evidence.
