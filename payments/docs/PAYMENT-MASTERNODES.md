# Payment-network masternodes

This local development operator runs sixteen seed masternodes on the existing `lave-local-v1` payment chain. It retains that chain's genesis, named genesis, address encodings, block history, PoW, emission and quorum sizes. It does not use the separate eight-node `lave-quorum-v1` laboratory. All coins are local test coins; these processes do not create a public network or a production deployment.

The four existing payment nodes keep their roles and data. The seed operator adds wallet-disabled daemons on RPC ports 20301–20316 and P2P ports 20401–20416, bound only to `127.0.0.1`. It never stops the four payment nodes. Seed data, operator BLS secrets, signed transaction journals and the dedicated monitor live in `.runtime/lave/payment-masternodes/`; private files have mode 0600 and directories 0700. BLS secrets are read from private configuration files, not command arguments.

## Activation and unchanged quorum parameters

The explicit payment-devnet profile enables loopback masternode service addresses and fixes the development values for InstantSend, block filtering, DKG, ChainLocks, all-connected quorum peers and PoSe. These values apply only to the two explicitly named LAVE development profiles; no Dash spork authority keys are imported. Superblocks remain disabled. The payment chain uses the real clock; this operator never changes mock time or block timestamps.

| Purpose | Type | Members | Minimum size | Signing threshold | Active quorums | DKG interval |
| --- | --- | --- | --- | --- | --- | --- |
| ChainLocks | `llmq_devnet` / 101 | 12 | 7 | 6 | 4 | 24 blocks |
| Rotated InstantSend | `llmq_devnet_dip0024` / 105 | 8 | 6 | 4 | 2 | 48 blocks |

Sixteen seed masternodes provide the intended full population for the two rotated InstantSend sets and twelve-member ChainLocks groups. This is a bootstrap target, not a claim that sixteen is the absolute consensus minimum. The existing quorum sizes and signing thresholds have not been weakened.

## Operator commands

Run commands from `payments/`, after building the current Core and starting the existing LAVE payment runtime:

```sh
npm run payment-mn:start
npm run payment-mn:status
npm run payment-mn:verify
npm run payment-mn:mine -- 1
npm run payment-mn:stop
```

`start` creates or loads the dedicated descriptor wallet `lave-quorum-seeds` on the miner, mines fresh development funds directly to that wallet, signs and records each exact funding and ProReg transaction before broadcasting, registers sixteen deterministic masternodes with 1,000 LAVE collateral each, and explicitly locks every collateral outpoint. Funding never spends the existing miner, customer, merchant or MOVE funds. Each seed has persisted owner, voting, payout and collateral addresses and a distinct operator BLS key.

The initial bootstrap can take tens of minutes: before usable quorums exist, the existing block-filtering policy can hold a newly seen unlocked transaction out of blocks for 600 real seconds. Funding and registrations are separate batches. The operator waits and mines with the real clock; it does not bypass this rule. DKG then proceeds with paced blocks and observed authenticated connections, contributions and commitments. Ordinary `mine` commands are paced and bounded to 1–500 blocks. Do not run a separate miner concurrently during bootstrap.

`stop` stops only the sixteen seed daemons and their status monitor. Registration and collateral remain on the existing chain, and collateral remains locked. Stopping a daemon does not deregister a masternode or make its collateral spendable through this operator. Restarting uses the same keys, registrations, exact signed transactions and data directories.

A mutation lock serializes operator actions. After an abnormal interruption, inspect its recorded process ID and command before removing a stale lock; never delete a lock belonging to a live operation. Signed journals are atomically replaced and fsynced before broadcast. Reruns rebroadcast the same transaction bytes instead of silently creating a replacement transfer.

## Evidence and public status

The independent monitor publishes a sanitized snapshot every three seconds in `.runtime/lave/payment-masternodes/public/status.json`. The cashier can read this public snapshot without access to RPC cookies or operator keys. The read-only status adapter rejects a foreign chain or either wrong genesis hash; snapshots older than fifteen seconds or implausibly future-dated lose their capability flags.

The snapshot includes the pinned network identity, individual node reachability and identity checks, enabled masternode counts, actual committed quorum membership, a cryptographically verified latest ChainLock, a recorded and reverified InstantSend signature, and actual masternode coinbase payout proofs. Capability flags require actual signature evidence and enough currently observed authenticated masternode members for the signing threshold. Spork activation alone never sets a verified capability.

`verify` signs a small self-payment from the dedicated seed wallet, journals it before broadcast, obtains its actual `getislocks` BLS proof, verifies that proof and propagation to all twenty known nodes, and checks that changing the transaction ID invalidates the signature. It then confirms the payment, verifies a fresh ChainLock, checks its propagation and the payment's containing block, and rejects the same signature for a changed block hash. It also requires at least one actual masternode payout output in a coinbase transaction. The public report is `public/verification.json`.

Verification does not interrupt all masternodes on the shared payment chain. The separate LAVE-Q laboratory retains its own all-masternodes-offline and recovery test. Neither report is a claim of mainnet readiness, public decentralization, price stability or profitable rewards.
