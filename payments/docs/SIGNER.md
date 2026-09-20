# Customer-controlled signing lab

This is a local named-devnet experiment with real Dash 23.1.8 PSBTs and transactions. The merchant wallet is on node 2 (`merchant`), and the customer wallet is on node 3 (`customer`). Version 0.3 uses this signing policy in separate customer and merchant browser wallets; see [WALLET.md](WALLET.md). The customer CLI shares its durable journal with the customer browser wallet. The original server-funded regtest API remains a separate legacy experiment on port 4180.

The customer command owns its node RPC interaction. It never sends a private key, wallet cookie, unsigned PSBT, or signing command to the payment API. The API's lab dashboard credentials allow chain inspection only. The miner, merchant, and customer nodes have separate data directories and wallets.

These processes still run as the same operating-system user. A compromised process with that user's filesystem permissions could read another node's cookie or wallet files. This is a verified application boundary and approval workflow, not an operating-system security boundary, a hardware wallet, or a production custody design. Deployments need separate accounts/containers or a genuinely customer-owned device, protected key storage, authentication and further security review.

## Try it

From `payments`, start the named devnet with `npm run lab:start`. Create a merchant payment request:

```sh
npm run signer:request -- --amount 0.25 --description "Order #1042" --merchant "Atlas Studio" --out .runtime/order-1042.json
npm run signer -- prepare .runtime/order-1042.json
```

The prepared review prints a request ID, destination, exact amount, fee, change, named-network identity and fingerprint. On the customer terminal, approve that ID:

```sh
npm run signer -- approve <request-id>
```

Read the destination and all amounts. Approval requires typing `APPROVE` followed by the complete displayed fingerprint. The command requires a real interactive terminal; there is no `--yes` option, piped approval or API signing endpoint. Merchant names and descriptions are unverified labels. The request hash is a checksum that detects changes, **not merchant identity authentication**.

The transaction must reach the miner through P2P relay before a mined block can include it. An immediate `npm run lab:mine -- 1` can produce a block before relay finishes; allow propagation and mine another block if the payment remains pending. Inspect the merchant receipt through its node or the integration report.

`npm run signer -- status <request-id>` reads the pinned customer chain and reports `confirmationState` (`pending`, `confirmed`, `conflicted` or `unknown`), `confirmations` and `inMempool`. The saved journal `state: "broadcast"` remains distinct from current confirmation. A reorganization can return a confirmed transaction to pending; missing transactions and unavailable or mismatched chains report unknown. Status is read-only and never signs, broadcasts or changes the journal. A prepared draft without a transaction also reports unknown confirmation.

To release reserved coins for an unsigned request:

```sh
npm run signer -- cancel <request-id>
```

Cancellation unlocks only that draft's known inputs. It refuses signed, broadcasting or uncertain transactions. It does not revoke a transaction already signed or sent. An expired unsigned prepared request can still be cancelled.

## Validation and persistence

- Requests pin the exact named chain, devnet name, ordinary genesis hash and named-devnet block 1 hash. Testnet-style addresses and a PSBT alone do not identify a chain; ordinary genesis hashes are shared by some Dash test environments.
- Amounts are decimal strings with at most 8 places and a matching integer satoshi field. All money arithmetic uses integers. Invoice payment is exact; fees are paid separately.
- The customer constructs the unsigned transaction itself. Before signing, it checks every input against a confirmed unspent output and the customer's wallet, and compares PSBT previous-transaction data to the live node.
- There must be exactly one requested merchant output and at most one change output to the customer's predetermined change address. Arbitrary output scripts, imported signatures and unsafe signature modes are rejected. Signing explicitly uses `SIGHASH_ALL`.
- The absolute fee limit is 0.0001 test DASH (10000 satoshis), with an additional 10 satoshi/byte cap. A fixed 1 satoshi/byte construction rate is used in this lab. The final signed transaction must match the approved input/output template, and mempool acceptance is tested before broadcast.
- Chain identity, expiry, ownership, selected UTXOs and transaction contents are rechecked after customer approval. Terminal and bidirectional control characters are rejected in displayed merchant text.
- SQLite uses full synchronous writes. A request ID is permanently bound to its request hash. A draft reserves inputs with persistent wallet locks. Signed bytes and their final transaction ID are stored before broadcasting.
- A lost broadcast response never creates a replacement payment. A retry reconciles the saved transaction ID or rebroadcasts precisely the same signed bytes. No new transaction is funded or signed for that request.

A crash while preparing, awaiting approval or signing fails closed and can require manual inspection of the journal and customer wallet reservations. The application does not automatically clear these ambiguous states. Network splits, spent inputs, expired signed transactions and rejected/conflicting transactions also require inspection; there is no automatic fee bump or replacement workflow. Reserved funds are not spent merely by preparing a PSBT.

## Verification

`npm test` includes signer policy, approval, replay/restart, cancellation and command-line tests. `npm run test:signer` exercises the actual three-node devnet: merchant request, unsigned PSBT, tampering rejection, declined approval, customer signing, a simulated lost broadcast response, restart reconciliation, propagation and independent merchant confirmation. Integration tests deliberately authorize devnet test coins programmatically; they do not pretend a human approved the terminal prompt.

The report is saved in `.runtime/signer/integration-report.json`. Customer CLI state is stored in `.runtime/signer/customer.sqlite`; integration state uses a separate database. Neither report contains private keys or RPC credentials.
