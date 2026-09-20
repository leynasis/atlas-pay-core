# Separate local wallets

The customer wallet runs at `http://127.0.0.1:4174`; the merchant refund wallet runs at `http://127.0.0.1:4175`. Both use the pinned `atlas-local-v1` named devnet. The merchant invoice API runs separately on port 4173. These are development services for test coins, not production custody or a public network.

Run all three services with `npm start` after starting the lab and building the frontend. Individual entry points are `node wallet/index.mjs customer` and `node wallet/index.mjs merchant`. Each service binds only `127.0.0.1` and accesses only its own node and wallet. The customer CLI and browser service share `.runtime/signer/customer.sqlite`, so the same request cannot create independent payments through the two interfaces. Merchant refunds use `.runtime/signer/merchant.sqlite`.

Opening an invoice link does not prepare or sign a transaction. The customer explicitly prepares the invoice, reviews the destination, exact amount, fee, total, change, network and fingerprint, then approves that fingerprint. The merchant similarly reviews and approves a refund using the merchant wallet. The invoice API cannot sign a payment or refund.

Before creating a new signature, the wallet re-fetches the immutable request from the fixed merchant API and compares its request ID and checksum with the prepared record. A paid, partially paid, expired or changed request is rejected. The checksum detects content changes; merchant labels are unverified and it does not authenticate a merchant. Once bytes have been signed, a retry reconciles or broadcasts exactly those bytes rather than funding another transaction. Current confirmation state is read from the owning node; a saved broadcast state does not by itself mean confirmed.

Refund registration follows the actual broadcast. If the merchant API is temporarily unavailable, the wallet preserves the transaction ID and returns `receiptPending: true`. Refreshing the saved request retries registration with a persistent idempotency key. The invoice API independently checks the actual refund transaction before accepting the receipt. No signature or broadcast occurs merely from refreshing a request.

## HTTP contract

- `GET /api/wallet/status` returns `role`, the pinned `network`, confirmed `balance`, `pendingBalance` (both the wallet's own unconfirmed change and externally received pending funds), a persistent `receiveAddress`, `chainAvailable`, `blockHeight`, and a `csrfToken`. Unconfirmed change moves into the confirmed balance after a block; it is not omitted or counted twice. Immature coinbase funds are excluded. An unavailable node or inconsistent balance snapshot produces null monetary values, never invented zero balances.
- `POST /api/wallet/prepare` accepts `{invoiceId, kind}`. Customer kind is `payment`; merchant kind is `refund`. The service imports from the fixed invoice API, never from a URL supplied by a browser.
- `POST /api/wallet/approve` accepts `{requestId, fingerprint}`. The fingerprint must match the saved review. This is the explicit browser approval action. The original CLI still requires its interactive terminal approval.
- `POST /api/wallet/cancel` accepts `{requestId}` and releases only an unsigned draft's reserved inputs.
- `GET /api/wallet/requests/:id` returns a live review and retries any outstanding refund receipt synchronization.

Action and request responses are `{review}`. Reviews include `id`, `role`, `kind`, `invoiceId`, `state`, merchant labels, `address`, `network`, `expiresAt`, `amount`, `fee`, `total`, `changeAmount`, `changeAddress`, `fingerprint`, `txid`, current confirmation information, `receiptSync`, and `receiptPending`. Receipt states are `not_applicable`, `pending`, and `synced`.

The status endpoint establishes a random, in-memory session using a role-specific HttpOnly cookie with `SameSite=Strict`. Every POST requires that cookie, the returned token in `X-CSRF-Token`, and the exact wallet `Origin`. Hosts are restricted to the actual `127.0.0.1` listener. There is no signing CORS or development-origin exception; framing is denied. Session tokens expire after six hours and restart invalidates them. Reload the wallet to get a new session. JSON bodies are limited to 16 KiB. Cookies are not isolated by port, so the services deliberately use different cookie names and independently validate Origin and token.

## Limits and recovery

Preparation does not spend funds. Only confirmed inputs are accepted by signer policy. Wait for a block after a payment before trying to spend its change. The same amount and fee limits, input ownership checks, change policy and final transaction comparison described in [SIGNER.md](SIGNER.md) apply to both roles.

Cancelled request IDs remain cancelled. To pay after cancellation, create a new invoice/request. A crash in preparing, awaiting approval, or signing can require manual inspection; the system never silently clears ambiguous reservations. A signed or uncertain broadcast can be retried explicitly using the same request and fingerprint. Rejected or conflicting transactions are not automatically replaced, and cancellation cannot revoke a signature already created.

The invoice API uses a separate method-restricted RPC credential. It can inspect the merchant chain and receipts and allocate merchant receiving addresses. Daemon-side RPC permissions deny signing, sending, wallet export, and administration. Dashboard credentials remain restricted to four chain-inspection methods. Existing running lab nodes must be restarted after upgrading their credential configuration; newly started nodes receive it automatically.

All services still run as the same operating-system user. Their application-level credential separation does not prevent that user, or a compromised process with the same filesystem access, from reading another wallet's cookie or keys. Separate OS accounts, containers or customer-owned devices, secure key storage and further review are required for production isolation. Wallet and session data stay outside the built frontend; private keys and RPC credentials are never returned to browsers.

`node --test tests/wallet.test.mjs` checks role restrictions, shared preparation, fingerprint and current-invoice approval checks, lost-response preservation, receipt retry, and real HTTP Host/Origin/session/token guards. The signer suite separately checks monetary and transaction policies. Live integration tests authorize only named-devnet test coins.
