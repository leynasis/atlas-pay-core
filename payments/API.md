# Atlas Pay local prototype API

The server listens on 127.0.0.1:4173. Every monetary endpoint is restricted to an isolated Dash **regtest** chain. Amounts are decimal strings in DASH (test coins), never fiat or floating-point input. No mainnet support.

- `GET /api/status` → `{ network: "regtest", connected: boolean, blockHeight: number|null, currency: "DASH", balances: {merchant: string, payer: string}, capabilities: {instantSend: false, chainLocks: false}, error?: string }`
- `GET /api/invoices` → `{ invoices: Invoice[] }`, newest first, refreshed from the chain.
- `POST /api/invoices` body `{ amount: "0.25", description: "Order #1042", merchantName: "Atlas Studio", expiresInMinutes: 60 }`, header `Idempotency-Key` (UUID) → `{ invoice: Invoice }`.
- `GET /api/invoices/:id` → `{ invoice: Invoice }`.
- `POST /api/invoices/:id/pay` → `{ invoice: Invoice, txid: string }`. Test payer wallet sends remaining invoice amount. Request requires `Idempotency-Key`.
- `POST /api/dev/mine` body `{ blocks: 1 }` → `{ blockHeight: number }`. At most 10 blocks. Explicit regtest action.
- `POST /api/invoices/:id/refund` → `{ invoice: Invoice, txid: string }`. Test merchant returns the invoice payment to the local test payer; separate blockchain transaction. Request requires `Idempotency-Key`.
- `GET /api/invoices/:id/qr` → SVG image encoding invoice.paymentUri.

`Invoice`: `{ id, amount, amountSats, description, merchantName, address, paymentUri, createdAt, expiresAt, status, receivedAmount, confirmedAmount, overpaid, paymentTxid: string|null, refundTxid: string|null }`. Amount fields are strings; times ISO-8601 UTC. Status: `pending | partial | detected | paid | expired | refund_pending | refunded`. Pending means unpaid. Detected means amount received but not fully confirmed. Paid requires at least one block confirmation (NOT InstantSend). A late payment is detected and shown even after expiry. Error: `{ error: { code, message } }` with appropriate HTTP status.

The frontend uses same-origin fetch only, never receives RPC credentials or wallet private keys. Host and Origin validation protect local mutation endpoints. This local demo is not a production custody model. No pre-populated successful payments or fabricated chain data.

Refund reconciliation also returns `refundAmount` and `additionalReceivedAfterRefund` decimal strings, `requiresReview` boolean and nullable `reviewReason`. The UI must prominently flag review-required invoices even if the original refund is confirmed. A conflicted/abandoned refund or additional funds after a refund requires manual wallet inspection; no automatic second refund is attempted. The local pay helper rejects expired invoices, while late external regtest receipts are still recorded.

For frontend development only, launch the API with `ATLAS_DEV_ORIGIN=http://127.0.0.1:5173` (`npm run start:dev`) and Vite with `npm run dev`. The exception is restricted to that exact origin; production-build local serving uses the default same-origin checks.

## Network lab monitoring

`GET /api/lab/status` returns the separate local named-devnet snapshot. It never
changes the payment application's regtest chain. Top-level fields include
`name`, `mode`, `localOnly`, `configured`, `observedAt`, `expectedNodes`,
`onlineNodes`, `synchronized`, `commonHeight`, `commonTip`, `genesisHash`,
`devnetGenesisHash`, `capabilities`, and `nodes`.

Each node reports `id`, `label`, `online`, `height`, `bestBlockHash`, `peerCount`,
`peers`, `identityVerified`, and a sanitized `error`. Unavailable measurements
are null. Synchronization requires matching observed heights and block hashes;
it is a sampled status, not a consensus guarantee. A network outage is not
reported as zero-height consensus or a successful payment.

There are no web endpoints for lab signing, mining, starting or stopping nodes.
The monitor must not return RPC credentials, wallet keys, raw configuration or
runtime filesystem paths. Existing Host restrictions and no-store headers apply.
