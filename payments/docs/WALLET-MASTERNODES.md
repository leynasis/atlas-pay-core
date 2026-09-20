# Wallet-managed LAVE masternodes — v0.6

Open the customer wallet at `http://127.0.0.1:4174/#masternodes` or the merchant
wallet at `http://127.0.0.1:4175/#masternodes`. Each role can manage one local
ordinary masternode on the existing `devnet-lave-local-v1` payment chain.
This release uses real Core transactions and daemons with valueless test LAVE.
The computer owner, wallet service and Core processes remain trusted.

## Launch from a wallet

1. Receive at least **1000 confirmed, spendable LAVE plus fees**. Reserved coins,
   immature rewards and pending incoming funds cannot satisfy the requirement.
   The wallet does not automatically mint or obtain collateral.
2. Choose a name. Review the first transaction: exactly 1000 LAVE to an address
   owned by this wallet, its fee, change and immutable fingerprint. Approve it.
3. Wait for the collateral transaction to enter a block. Its exact output is
   reserved with a persistent Core wallet lock and recorded in the signing journal.
4. Review and approve registration separately. This transaction pays only the
   registration fee; the 1000-LAVE output remains intact. The review binds the
   collateral, owner, voting and payout addresses, BLS public key and fixed local
   service address. `register_prepare` is unsigned; `register_submit(..., false)`
   signs without broadcasting so the exact signed bytes can be durably recorded first.
   Registration fees use confirmed wallet change, normally created by the collateral
   transaction. An invoice receiving address cannot be selected as the fee source;
   without suitable change the wallet asks for funds and signs nothing.
5. After registration confirms, start the node. The status distinguishes a running
   process, synchronization, on-chain registration and Core's `READY` state.
   Synchronization also requires actual masternode sync and connected peers;
   an isolated process at the same height does not count as active.

Customer node ports are RPC 20201 / P2P 20211; merchant node ports are
RPC 20202 / P2P 20212. All listeners use `127.0.0.1`. The application launches only
the source-built executable matching the local build manifest. Browser input
cannot supply an executable, file path, RPC destination or public endpoint.

## Collateral and withdrawal

**Stop** stops the daemon and keeps collateral reserved. Ordinary payments,
refunds and registration fees exclude that output. The journal reapplies the
reservation before payment preparation/approval and normal wallet refresh;
native persistent locks also survive Core restarts.

**Retire** creates a separate review of a transaction spending exactly the
collateral output back to an owned wallet address, less the displayed fee.
The output stays reserved while this draft is being reviewed; cancelling keeps
the lock. Approval journals the signed bytes before broadcast. Retirement is
complete only after the collateral spend confirms. The deterministic masternode
then leaves the active list. A reorganization is rechecked against actual UTXO
and transaction state.

Creating a replacement node additionally waits until the retirement transaction
has a ChainLock. Until then the previous generation and its operator key remain
available for reconciliation. Reorganized collateral, registration and retirement
requests retry their saved signed bytes instead of creating a second signature.

This is a wallet reservation plus the network's collateral eligibility rule,
not a consensus-enforced escrow or fixed-duration timelock. A person controlling
the private keys can spend through another tool; doing so removes eligibility.

## Rewards and backups

The UI sums actual coinbase payouts to the node's payout address, separating
mature rewards from immature rewards. It excludes ordinary incoming transfers
and orphaned rewards. If the bounded history scan cannot establish a complete
total, the total is unavailable rather than a partial number. There is no APR
estimate or guaranteed income. Miners create blocks; masternodes receive their
protocol-defined service payments. Existing emission rules, including the
Platform credit-pool allocation, remain inherited; Platform itself is not deployed.

Operator keys and masternode transactions live in the same private SQLite journal
as wallet signing. The encrypted `.lavebackup` therefore includes these keys in
addition to the Core wallet. The daemon configuration materializes its BLS secret
in a mode-600 private file, never in process arguments or public JSON.
Recovered archives remain `RECOVERY_LOCKED`: no fresh payments, registration,
retirement or node-control operations are automatically enabled from an old snapshot.

## Payment-network quorum bootstrap

For the local operator, the separate `payment-mn:*` commands provision sixteen
seed masternodes on **the same payment chain**:

```sh
npm run payment-mn:start
npm run payment-mn:status
npm run payment-mn:verify
npm run payment-mn:mine -- 1
npm run payment-mn:stop
```

Seed collateral belongs to the dedicated `lave-quorum-seeds` wallet on the miner.
The launcher mines its own test funds and journals signed transactions before
broadcast. It never spends customer, merchant or MOVE wallets. Seed RPC ports
are 20301–20316 and P2P ports 20401–20416; private data is under
`.runtime/lave/payment-masternodes/`. Stopping seeds preserves all wallets/data
and does not stop the four payment nodes or the separate LAVE-Q laboratory.

| Feature | Type | Size / minimum / threshold | Cycle | Active quorums |
| --- | --- | --- | --- | --- |
| ChainLocks | LLMQ_DEVNET (101) | 12 / 7 / 6 | 24 blocks | 4 |
| Rotated InstantSend | LLMQ_DEVNET_DIP0024 (105) | 8 / 6 / 4 | 48 blocks | 2 |

These parameters, both genesis hashes, message bytes and address prefixes are
unchanged. Six existing DKG/InstantSend/ChainLocks/connectivity/PoSe sporks are
fixed active for this explicit local profile; superblocks remain disabled.
Upgrade all local nodes together. The payment clock remains real and non-mockable.
Initial transactions may wait through the inherited ten-minute mining safety
window before quorums exist. DKG then requires multiple historical rotation
quarters and actual authenticated messages; allow time for bootstrap.

The cashier reads only sanitized public monitor snapshots, never private seed
RPC cookies. Missing, wrong-chain, future-dated or stale snapshots cannot claim
verified capabilities. Each ChainLock identifies its actual block and height.
Invoice `paid` still requires a block confirmation; a network capability badge
does not make every invoice an InstantSend payment. The old LAVE-Q proofs are
kept separate. All these processes share one computer and operator, so this is
not a public or decentralized deployment.
