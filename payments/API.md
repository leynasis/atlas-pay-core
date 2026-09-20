# LAVEPAY v0.5 local API

Default applications bind only `127.0.0.1`: merchant/checkout `4173`, customer wallet `4174`, merchant refund wallet `4175`. The default profile pins `devnet-lave-local-v1`, both genesis hashes and `currency: "LAVE"`. Explicit `LAVEPAY_NETWORK=atlas` retains its original chain identity and test DASH; amounts are exact decimal strings. These are valueless local test units. The default LAVE cashier is watch-only, while the private refund wallet runs on its separate signer node.

## Merchant — port 4173

| Method / path | Input | Result |
|---|---|---|
| `GET /api/status` | — | Network, connected state, block height, merchant balance, wallet URLs, capabilities including `serverCanSign: false`, `watchOnly`, and payment-chain `instantSend: false`, `chainLocks: false` |
| `GET /api/invoices` | — | `{ invoices }`, refreshed from chain |
| `POST /api/invoices` | `{ amount, description, merchantName, expiresInMinutes }` + UUID `Idempotency-Key` | HTTP 201 `{ invoice }` |
| `GET /api/invoices/:id` | — | `{ invoice }` |
| `GET /api/invoices/:id/request` | — | Raw immutable signer request (not an envelope) |
| `GET /api/invoices/:id/qr` | — | SVG encoding local checkout URL |
| `POST /api/invoices/:id/refund-request` | `{ address, amount? }` + UUID key | HTTP 201 `{ invoice, request }`; full confirmed received amount only |
| `GET /api/invoices/:id/refund-request` | — | `{ invoice, request }` for pending immutable refund |
| `POST /api/invoices/:id/refund-receipt` | `{ requestId, txid }` + UUID key | `{ invoice, txid }` after independent wallet/transaction verification |
| `POST /api/dev/mine` | `{ blocks: 1..10, invoiceId? }` | Local test mining result; waits for known pending transactions to relay |
| `GET /api/masternodes/status` | — | Sanitized LAVE-Q snapshot, separate from payment network; explicit stale/verified proof fields |
| `GET /api/lab/status` | — | Selected payment network snapshot (four LAVE nodes; three legacy Atlas nodes) |

There is no merchant `/pay`, `/refund`, signing or generic RPC endpoint. Request creation does not spend. Changing a payload under the same idempotency key conflicts. Refund addresses must be explicit and outside the merchant wallet; the API does not infer a customer's destination from input addresses.

An invoice includes `id, amount, amountSats, description, merchantName, address, paymentUri, checkoutUrl, createdAt, expiresAt, status, receivedAmount, confirmedAmount, overpaid, paymentTxid, refundTxid, refundAmount, refundRequestId, refundAddress, requestedRefundAmount, refundRequestStatus, paymentRequestAvailable, canRequestRefund, additionalReceivedAfterRefund, requiresReview, reviewReason`.

Invoice states: `pending | partial | detected | paid | expired | refund_pending | refunded`. Review flags are independent of state. `paid` requires a block confirmation; it never means InstantSend. External partial, excess, late and reorganized receipts are reconciled. Partial incoming payment blocks a new automatic full-payment request; the immutable request amount is not silently changed. Conflicted refunds and extra receipts require review, never a second automatic refund.

Requests include version, UUID, recipient, exact amount/satoshis, merchant label, description, issue/expiry time, full pinned network identity and a checksum. The checksum does not authenticate merchant identity.

## Wallets — ports 4174 and 4175

- `GET /api/wallet/status` returns role, network, balance, pending balance, stable receive address, chain availability/height and `csrfToken`. It establishes a role-specific HttpOnly SameSite=Strict session cookie.
- Every POST requires exact same-origin `Origin`, that cookie, `X-CSRF-Token`, and `Content-Type: application/json`.
- `POST /api/wallet/prepare` accepts `{ invoiceId, kind: "payment" | "refund" }`. Role must match the operation. Fetches the request from fixed merchant port 4173 and returns `{ review }`; no signature yet.
- `POST /api/wallet/approve` accepts `{ requestId, fingerprint }` and returns `{ review }`. The displayed transaction fingerprint must match. A fresh signature first rechecks the merchant request. A previously signed transaction can only be reconciled/rebroadcast as the same bytes.
- `POST /api/wallet/backup` accepts only `{ password }` (12–1024 UTF-8 bytes) and returns an encrypted binary attachment containing the native wallet and signing journal. Existing Host/Origin/session/CSRF checks and the 16 KiB request limit apply. LAVE descriptor wallets only. `RECOVERY_LOCKED` archives retain that lock. See [recovery](docs/WALLET.md).
- `POST /api/wallet/cancel` accepts `{ requestId }`, only for unsigned prepared drafts.
- `GET /api/wallet/requests/:id` restores `{ review }`, including current chain confirmation state and refund receipt synchronization. A receipt may retry without another signature.

Review fields include `id, role, invoiceId, kind, state, merchantName, description, address, network, expiresAt, amount, fee, total, changeAmount, changeAddress, fingerprint, txid, chainAvailable, blockHeight, confirmationState, confirmations, inMempool, receiptSync, receiptPending`. Unknown/offline is not confirmed. Interrupted ambiguous preparation/signing requires inspection. See [WALLET.md](docs/WALLET.md).

## HTTP and legacy support

Host/Origin are restricted, CORS is absent, frames are denied, wallet responses are no-store. These controls are not owner authentication. The standard macOS launcher additionally confines the cashier process; unsandboxed same-user processes and the host owner remain trusted. RPC secrets, PSBTs and plaintext private keys are not returned to the browser. The explicit backup endpoint returns password-encrypted wallet bytes. Errors use `{ error: { code, message } }`.

For merchant frontend development only, `npm run start:dev` allows exact Vite origin `http://127.0.0.1:5173`; `npm run dev` proxies the API. Wallet signing stays on its fixed ports with exact origin checks.

`npm run legacy:api` exposes the previous isolated-regtest API on **4180**, preserving `.runtime/invoices.sqlite`. It is API-only; the new frontend targets devnet. The legacy server-funded `/pay` and `/refund` helpers exist only there and are covered by `npm run test:legacy`.
