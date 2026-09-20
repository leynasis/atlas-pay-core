# Separate local wallets — v0.6

Both wallet roles include the [masternode workflow](WALLET-MASTERNODES.md):
separate collateral and registration approvals, persistent reservations, local
node controls, observed rewards, and reviewed collateral return. The encrypted
wallet journal also contains the managed node's BLS operator key. Recovery
blocks fresh masternode mutations as well as fresh payment signatures.

The customer wallet runs at `http://127.0.0.1:4174`; the merchant refund wallet
runs at `http://127.0.0.1:4175`. Both use the selected pinned payment profile:
`lave-local-v1` with test LAVE by default, or preserved `atlas-local-v1` with test
DASH under `LAVEPAY_NETWORK=atlas`. The invoice API is on 4173. These are local
development services, not production custody or a public network.

Run all three with `npm start` after starting the lab and building the frontend.
Individual wallet commands are `npm run start:customer-wallet` and
`npm run start:merchant-wallet`. Both bind only `127.0.0.1`.

| LAVE service           | Signing node / wallet             | Durable journal                        |
| ---------------------- | --------------------------------- | -------------------------------------- |
| Customer :4174         | `customer`, RPC20003 / `customer` | `.runtime/lave/signer/customer.sqlite` |
| Merchant refunds :4175 | `signer`, RPC20004 / `merchant`   | `.runtime/lave/signer/merchant.sqlite` |

The cashier's `merchant` node, RPC20002, contains only the public-descriptor
`cashier` wallet. Refund signing keys remain on the fourth node. The refund
service also reads the cashier's public descriptors through its restricted
credential to keep tracked address ranges current. Only the cashier allocates
external invoice addresses; the signer uses its internal change branch.

The customer CLI and browser share the same journal, preventing independent
payments for the same request. Atlas keeps the original paths without `lave/`
and its original merchant signing node. No data or balances migrate between
profiles. Browser bookmarks bind the exact chain and genesis.

## Review and approval

Opening a link does not prepare or sign. The customer explicitly prepares an
invoice, reviews destination, amount, fee, total, change, network and fingerprint,
then approves that fingerprint. The merchant reviews refunds similarly. The
cashier API cannot sign either transaction.

Before a fresh signature, the wallet re-fetches the immutable request from the
fixed merchant API and compares the ID/checksum with the prepared record. Paid,
partially paid, expired or changed requests fail. The checksum detects changes;
it does not authenticate the displayed merchant name. Already signed requests
retry their saved bytes, never fund another transaction. Live confirmation
state comes from Core; a saved broadcast state alone does not mean confirmed.

Refund registration follows broadcast. If the merchant API is unavailable, the
wallet preserves txid and reports `receiptPending: true`. Refresh retries
registration with its saved idempotency key, and the cashier independently
verifies the transaction. Refresh itself does not sign or broadcast.

## HTTP contract

- `GET /api/wallet/status` returns role, profile, currency, pinned network, confirmed/pending balances, receive address, availability, height and a CSRF token. Pending change and external receipts are included once; immature coinbase funds are excluded. Unavailable or inconsistent balances are null, not invented zeros.
- `POST /api/wallet/prepare` accepts `{invoiceId, kind}`: customer `payment` or merchant `refund`. Requests come from the fixed invoice API, never a browser-supplied URL.
- `POST /api/wallet/approve` accepts `{requestId, fingerprint}` matching the saved review. This is explicit browser approval; the CLI requires interactive terminal approval.
- `POST /api/wallet/cancel` accepts `{requestId}` and releases only unsigned draft reservations.
- `GET /api/wallet/requests/:id` returns the current review and retries outstanding refund receipt synchronization.
- `POST /api/wallet/backup` accepts `{password}` and returns an encrypted `.lavebackup` download for the selected LAVE role. It uses the same wallet Host/Origin/session/CSRF checks.

Action responses contain `{review}` with role/kind/invoice, monetary fields,
network, request state, fingerprint, txid, confirmation information and receipt
synchronization state. See [API.md](../API.md) for the complete contract.

Status establishes a role-specific random in-memory session with an HttpOnly
`SameSite=Strict` cookie. Every POST requires that cookie, its token in
`X-CSRF-Token` and the exact wallet Origin. Host is restricted to the loopback
listener; no signing CORS or development-origin exception exists. Framing is
denied. Sessions expire after six hours or a restart; reload to obtain a new
one. Bodies are limited to 16 KiB. Cookies are not isolated by port, hence
separate names and Origin/token validation for each service. These sessions are
CSRF protection, not authenticated wallet-owner login.

## Encrypted backups and fresh-directory recovery

The backup section in either LAVE wallet exports its Core descriptor wallet and
signing journal together. Enter and confirm a new password; the application does
not retain that password. AES-256-GCM encrypts the payload and authenticates its
metadata; scrypt derives the key with a fresh salt. The service validates the
role, exact LAVE chain, wallet format and stable journal state before capture.
Unfinished signing/preparation states require inspection before backup.

The CLI offers the same export plus recovery. From `payments/`:

```sh
npm run backup -- --help
npm run backup -- export customer /absolute/private/path/customer.lavebackup
npm run backup -- export merchant /absolute/private/path/merchant.lavebackup
npm run backup -- restore customer /absolute/private/path/customer.lavebackup /absolute/private/path/recovered-customer
```

Choose existing private parent directories and a new output filename/directory.
CLI passwords are entered invisibly in an interactive terminal, never as
arguments, environment values or piped stdin. Export asks twice. The service
accepts 12–1024 UTF-8 bytes; use a strong password stored separately from the
backup. Without it the copy cannot be opened. Atlas backups are not supported
by this workflow and cannot be relabeled as LAVE.

Recovery validates encryption, role, pinned chain, wallet application ID and
journal consistency. It creates `wallet.dat`, `signer.sqlite` and `recovery.json`
in a **new directory**, never overwriting or loading a running wallet. These
extracted files are unencrypted private files with restricted permissions.

The recovered journal is **recovery-locked**: new preparation and new signatures
are rejected. Only explicit retries of the exact signed transactions already
saved in that snapshot are allowed. An old backup cannot account for payments
made later, and the CLI provides no automatic unlock or history-reconciliation
shortcut. This release supplies a conservative recovery artifact, not automatic
return to normal spending.

A cross-process role lock serializes backup with wallet mutations and public
descriptor synchronization. A leftover lock after a crash requires inspection;
it is not silently stolen. Direct Core RPC access remains trusted and outside
the application's lock.

The export covers one private signing wallet and its journal. It does not back
up the cashier invoice database, all node data or LAVE-Q operator keys. It does
not encrypt live Core wallets or the private original-wallet archive retained
by the cashier migration.

## Spending limits and trust

Only confirmed inputs are eligible. Wait for a block before spending pending
change. Amount/fee limits, ownership, change and final transaction checks follow
[SIGNER.md](SIGNER.md). Cancelled IDs stay cancelled; use a new invoice/request.
Crashes in ambiguous preparation/signing states require inspection. A signed or
uncertain broadcast retries the same request and fingerprint; cancellation
cannot revoke an existing signature.

On macOS, the default app launcher confines the cashier so it cannot read
signer files or contact wallet HTTP ports. Wallet services and Core nodes remain
trusted and unsandboxed under the host owner. Other same-user processes with
filesystem access may read keys. There is no customer-device isolation or
production owner authentication. Plaintext private keys and RPC secrets never
go to the browser; explicit backup export returns encrypted wallet bytes.
See [SECURITY.md](SECURITY.md) for the exact boundary.

Unit suites exercise policy, role restrictions, approval/receipt recovery, HTTP
guards, encrypted-file integrity and recovery locks. `npm run test:backup` and
`npm run test:cashier` exercise live LAVE wallets. Run live suites serially and
consult [VALIDATION-V05.md](VALIDATION-V05.md) for recorded results.
