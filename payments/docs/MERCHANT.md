# Named-devnet merchant API

The v0.3 merchant service listens on `127.0.0.1:4173` and serves `web/dist`, including `/pay/<invoice-id>`. It keeps a separate SQLite ledger in `.runtime/merchant/invoices.sqlite`. The original regtest service and its payer are a legacy demonstration with a separate database; their invoices are not imported into this named-devnet ledger.

The merchant service can create receiving addresses and inspect its wallet through a dedicated RPC credential. The daemon restricts that credential to an explicit list of address and read methods. It cannot sign, send, export keys, or access the customer wallet. Customer payment signing happens in the separate wallet service on port 4174; merchant refund signing happens in the separate wallet service on port 4175. No direct `/pay` or `/refund` spending endpoint exists on the merchant API.

The optional development mining endpoint has a narrowly scoped code path to the miner node's administrative RPC. It never reads the merchant or customer administrative cookies; synchronization checks use dashboard read credentials. These services still share an operating-system user and filesystem permissions. The local UI has no merchant authentication or production custody isolation. It is intended only for the pinned local devnet and test coins.

## HTTP contract

All mutating requests require a JSON object with `Content-Type: application/json`. Creation and receipt endpoints require a UUID `Idempotency-Key`. Reusing a key with a different payload returns `409 IDEMPOTENCY_CONFLICT`. Body size is limited to 16 KiB. Host and Origin are restricted to the local service; CORS is not enabled. The optional development origin exception is exactly `http://127.0.0.1:5173`.

| Endpoint                                | Request / response                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/status`                       | Network identity, connection status, block height, merchant balance, separate wallet URLs and capabilities. There is no customer balance in this response. |
| `GET /api/lab/status`                   | Read-only three-node topology and synchronization state.                                                                                                   |
| `GET /api/invoices`                     | `{ invoices: Invoice[] }`, newest first, refreshed from the merchant chain.                                                                                |
| `POST /api/invoices`                    | `{ amount, merchantName, description, expiresInMinutes }` → `{ invoice }`. Amount is a decimal string, never a JSON number.                                |
| `GET /api/invoices/:id`                 | `{ invoice }`, reconciled with the merchant wallet.                                                                                                        |
| `GET /api/invoices/:id/qr`              | SVG encoding the local checkout URL `http://127.0.0.1:4173/pay/:id`.                                                                                       |
| `GET /api/invoices/:id/request`         | The raw immutable version-1 signer payment-request object.                                                                                                 |
| `POST /api/invoices/:id/refund-request` | `{ address, amount? }` → `{ invoice, request }`. Destination is explicit; omitted amount means the entire confirmed received total.                        |
| `GET /api/invoices/:id/refund-request`  | `{ invoice, request }`, after checking current receipt totals and request expiry.                                                                          |
| `POST /api/invoices/:id/refund-receipt` | `{ requestId, txid }` → `{ invoice, txid }`, after independent transaction verification. This endpoint never sends a refund.                               |
| `POST /api/dev/mine`                    | `{ blocks, invoiceId? }`, with 1–10 blocks. Returns block height and synchronization result; this is an explicit local test action.                        |

Errors have the shape `{ error: { code, message } }`. The service reports unavailable or mismatched pinned chains without exposing RPC credentials or internal paths.

`GET /api/status` returns `network: "devnet-atlas-local-v1"`, `mode: "devnet"`, `connected`, nullable `blockHeight`, `currency: "DASH"`, `balances: { merchant: "…" }`, and wallet URLs. `capabilities` contains `instantSend: false`, `chainLocks: false` and `serverCanSign: false`; these are application capabilities, not assertions about isolation from another process running as the same operating-system user.

## Invoice and signer requests

An invoice preserves the original fields `id`, `amount`, `amountSats`, `merchantName`, `description`, `address`, `createdAt`, `expiresAt`, `status`, `receivedAmount`, `confirmedAmount`, `overpaid`, `paymentTxid` and `refundTxid`. Money fields are strings; timestamps are ISO-8601 UTC.

The additional fields are:

- `checkoutUrl`: local application checkout link; QR codes encode this URL.
- `paymentUri`: the raw `dash:` payment URI, kept separate from the application checkout. A raw URI alone does not identify this named devnet and must not be presented as an interchangeable normal-wallet link.
- `paymentRequestAvailable`: whether a customer wallet may currently import the invoice request.
- `canRequestRefund`: whether all received funds are confirmed and no refund request exists.
- `refundRequestId`, `refundAddress`, `requestedRefundAmount`: the immutable request awaiting merchant approval.
- `refundRequestStatus`: `none`, `awaiting_approval`, `broadcast`, `confirmed` or `review`.
- `refundAmount`: the amount of a verified registered refund transaction; it remains zero while only a request exists.
- `additionalReceivedAfterRefund`, `requiresReview`, `reviewReason`: reconciliation exceptions that the UI must display prominently.

Payment requests contain `{ version: 1, id, merchantName, description, address, amount, amountSats, createdAt, expiresAt, network, requestHash }`. The payment request ID equals the invoice ID. The `network` object pins the named chain, devnet name and both genesis hashes. The hash is a checksum and binding for a prepared transaction, not merchant identity authentication.

The full original payment request never changes amount under the same ID. If a partial payment arrives, importing or approving another full payment is blocked for review. The received funds remain visible and can be fully refunded after confirmation. Late external payments are still reconciled, and overpayment is shown explicitly.

Separate wallet services must re-fetch the source request immediately before signing and compare its ID and hash with the reviewed request. They must reject invoices that became paid, partially paid, refunded, expired or otherwise ineligible while a review was open. This reduces stale approvals; a blockchain payment can still race an unrelated external payment and produce an overpayment, which the ledger exposes.

## Refund lifecycle

This version supports one immutable, full refund request per invoice. It does not implement a partial-refund ledger. The merchant supplies the destination; the service never infers a payer address from transaction inputs. The destination must be a valid address outside the merchant wallet. All received payments must be confirmed, and any supplied amount must equal that full received total, including overpayments.

Creating a request does not move money and does not mark an invoice refunded. Its unique request ID is separate from the invoice ID. The merchant wallet on port 4175 imports and reviews that request, signs a PSBT only after merchant approval, broadcasts, then reports the resulting transaction ID with a stable receipt idempotency key.

The API verifies that the merchant wallet knows a distinct outgoing transaction, with the exact requested destination and amount, a merchant-paid fee and only merchant-owned change outputs. It rejects an incoming payment reused as a refund, a transaction predating the request, a transaction already allocated to another invoice, conflicts, abandoned transactions and zero-confirmation transactions absent from the mempool. The transaction must be ordinary Dash payment data. A receipt retries safely; a conflicting transaction ID cannot replace a registered refund.

One block confirmation makes the registered refund `refunded`; a reorganization can return it to `refund_pending`. Conflicts, missing transactions and unconfirmed refunds absent from the mempool require review. The original transaction ID remains fixed; normal status returns only when that same transaction reappears or confirms. New incoming funds after a refund request invalidate further request imports; funds arriving after broadcast are explicitly flagged and do not trigger a second refund. Expired or ambiguous requests require wallet/ledger inspection; this version has no automatic replacement or refund-request reset.

Receipt registration is safe to retry with the same idempotency key after a transient RPC failure, delayed transaction visibility or a pending journal entry left by a crash. The original request/transaction fingerprint remains bound to that key. Retrying verifies the existing transaction again and atomically records its proof; it never creates or broadcasts a payment. Invalid proofs remain rejected, and a changed payload cannot reuse the key.

Receipt verification establishes that a matching real transaction exists. It is not a cryptographic invoice identifier embedded in the transaction, nor a substitute for authenticated merchant accounting in production.

## Mining and verification

P2P relay happens before block inclusion. With `invoiceId`, the mining endpoint briefly waits for the merchant to detect the payment and then waits up to ten seconds for its pending transaction IDs to reach the miner. If no payment is detected, it returns a clear error instead of implying an empty block confirmed the invoice. If the transaction is already confirmed, another block can still be mined. Global mining without an invoice simply produces blocks and does not promise to confirm a particular transaction.

`node --test tests/merchant.test.mjs` verifies precise amounts, immutable requests, restart/idempotency, partial and late receipts, reorganization, refund request changes, forged/stale/reused receipts, restricted method usage, Host/Origin protection, checkout QR content and static containment. The complete three-service wallet and merchant flow is tested separately by the checkout integration suite.
