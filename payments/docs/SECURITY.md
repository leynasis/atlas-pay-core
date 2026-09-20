# Prototype security boundaries — v0.6

This is a loopback development system with valueless test coins. HTTP and RPC
services are not ready for internet exposure.

## Implemented boundaries

- Payment operations pin `devnet-lave-local-v1`, both genesis hashes and the LAVE request currency. Atlas retains its original `devnet-atlas-local-v1` identity, data and DASH units; legacy regtest and LAVE-Q are separate chains.
- The LAVE cashier wallet contains public descriptors and reports `private_keys_enabled=false`. Its RPC credential additionally denies signing, sending, private export and administration. Refund keys are on the separate signer node, RPC20004. Atlas retains its previous wallet architecture.
- Customer payment and merchant refund signing use role-bound wallet processes and durable journals. Plaintext private keys and RPC credentials are never returned to browsers; explicit backup export returns encrypted wallet bytes.
- Wallet POST requests require exact Host/Origin, a role-specific HttpOnly SameSite session cookie and a secret CSRF header. Merchant endpoints check Host/Origin but have no merchant account authentication; wallet sessions do not establish owner identity.
- Browser navigation and preparation do not authorize a spend. Explicit approval must match the transaction fingerprint, and current invoice details are checked again before a fresh signature.
- Money uses bounded decimal strings and integer satoshis. PSBT policy checks confirmed owned inputs, exact recipient, owned change, signature mode and fee ceilings.
- Signed bytes and txid are persisted before broadcast. Lost responses recover the same transaction. Ambiguous preparation/signing states fail closed for inspection; cancellation is only for unsigned drafts.
- A request checksum binds contents but does not authenticate the merchant. Names remain unverified; source checks cannot atomically exclude simultaneous external payments.
- Refund receipts are checked against the real outgoing transaction. Extra receipts, conflicts and changed totals require review. Refund destinations are explicitly selected by the merchant.
- Development mining has a restricted credential; monitoring uses read-only credentials on all four payment nodes. There is no generic HTTP RPC proxy or node-start/stop endpoint.

A descriptor watch-only wallet may report tracked outputs as `ismine=true` under
inherited Core semantics. The custody assertion is `private_keys_enabled=false`
and inability to produce a signature for a valid funded PSBT, not the label on
an address or balance bucket.

## macOS cashier confinement

`npm start` and `npm run start:merchant` apply a deny-by-default Seatbelt profile
on macOS. The cashier can read required source/runtime libraries, its invoice
database, limited RPC credentials and public monitoring data. It may write only
its merchant data directory among application runtime directories. It cannot
read private wallet trees, signing journals, admin cookies or migration backups,
and cannot connect to signing HTTP services on 4174/4175. Network access is
limited to the configured loopback Core RPC ports and its own HTTP listener.
Core RPC whitelists enforce which methods those credentials can invoke.
Filesystem metadata and Homebrew runtime files remain readable; the profile
protects the private runtime contents rather than hiding every filesystem name.

The local verification suite exercises fourteen OS-boundary probes; recorded
results belong in [VALIDATION-V05.md](VALIDATION-V05.md). This scope is specific
to the cashier launched through the supplied wrapper. Directly invoking internal
entry points does not create the sandbox. `LAVEPAY_ISOLATION=off` explicitly
opts out; non-macOS hosts currently require this opt-out for a local demo.

The host owner, Core nodes and customer/refund signing services remain trusted
and unsandboxed. Other processes with that user's filesystem access can read
keys. There is no authenticated owner login, separate OS account for each role,
or customer-owned signing device. Cashier confinement does not establish those
stronger custody boundaries.

## Backups and sensitive runtime state

Wallet export encrypts a Core descriptor-wallet backup and matching signing
journal with AES-256-GCM; scrypt derives the key from a user-entered password.
Metadata is authenticated. Wrong passwords, corruption, a foreign role/network
and unsupported wallet formats are rejected. The CLI never accepts a password
through arguments, environment variables or piped stdin. Losing the password
makes that encrypted copy unrecoverable.

Recovery writes a new directory without replacing a live wallet. The recovered
journal blocks fresh preparation/signing and permits only exact saved signed
transaction retries, because a snapshot cannot include subsequent payments.
Recovery does not automatically reconcile later history or unlock spending.
See [WALLET.md](WALLET.md) for commands and scope.

Encryption protects exported `.lavebackup` files. Working Core wallets, recovered
files and the original v0.4 migration archive/backup remain unencrypted local
private files with restricted permissions. `.runtime/` also contains cookies,
limited credentials, invoices and signed raw transactions. It is Git-ignored
and must not be published. The wallet backup does not include the merchant's
invoice database, all node data, or LAVE-Q operator keys.

## Network and production limits

Payment-chain block confirmations are not InstantSend or ChainLocks. The
separate [LAVE-Q lab](MASTERNODES.md) tests quorum behavior on another chain;
its operator keys and local results do not secure merchant LAVE payments.

The payment chain now has its own [wallet-managed masternodes](WALLET-MASTERNODES.md).
Collateral reservation is a persistent wallet UTXO lock, not a cryptographic
timelock. Normal payment/refund preparation restores and excludes collateral;
retirement requires a separate approved self-spend. Stop never unlocks it.
Operator secrets are included in the encrypted signing-journal backup and stay
out of browser responses, public snapshots and command-line arguments.
The cashier can read only the payment-masternode public directory; it cannot
read seed or managed-node cookies/configuration or invoke their RPC services.

LAVE Core has local build provenance, not an independently audited or
reproducibly distributed release. Changed genesis, P2P bytes and address/key
encodings do not establish universal cross-chain replay protection. Atlas uses
its separately checksum-verified official Dash runtime.

Before public use: authenticate owners and merchants, sign expiring payment
requests, introduce public invoice capabilities, isolate customer signing on
trusted devices, review recovery activation, add rate limits/replay-safe
webhooks, remove development mining, and obtain independent security review.
Distributed network and fiat/payment operations remain separate milestones in
[ROADMAP.md](ROADMAP.md).
