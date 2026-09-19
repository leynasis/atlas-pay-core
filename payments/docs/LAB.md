# Atlas three-node development lab

This stage adds three independent Dash processes with separate data directories and wallets on **one computer**. It exercises real P2P block relay, wallet separation and recovery from a local partition. It is not a public network, a production chain, or evidence of independent operators or economic security. No Dash C++ consensus source has been modified or rebuilt; the lab uses the same checksum-verified official Dash Core 23.1.8 binary as the original prototype.

The existing single-node payment application remains on its original isolated regtest chain. Its wallets, invoice database and RPC port are separate from this lab.

## Run

From `payments/`, with Node.js 22.13+ and the dependencies installed:

```sh
node lab/start.mjs
node lab/status.mjs
node lab/mine.mjs 1
node lab/stop.mjs
```

`start` installs the pinned binary if necessary, verifies the network identity, connects the three nodes, loads their role-specific wallets, and supplies test funds when needed. `mine` accepts 1–110 blocks and waits for all three nodes to agree. `stop` leaves all data intact. Commands do not target the original regtest node.

## Network identity

The CLI name is `atlas-local-v1`; `getblockchaininfo.chain` returns **`devnet-atlas-local-v1`**, not the generic string `devnet`.

All Dash named devnets share block zero. Their distinct identity is the deterministic block at height one, whose coinbase commits to the name. The lab pins and checks both blocks before administrative operations:

| Property | Pinned value |
| --- | --- |
| Shared block zero | `000008ca1832a4baf228eb1553c03d3a2c8e02399550dd6ea8d65cec3ef23d2e` |
| Atlas block one | `6bf1e63db8f55984d9ddfe93b99f0dd11e5d593c2d7cbdf706c84c11b37827d2` |

This gives Atlas a distinct **named-devnet branch**, not a new production genesis, new address format or issued public asset. Addresses retain Dash's test-network encoding.

## Roles, ports and credentials

| Node ID | Role wallet | Loopback RPC | Loopback P2P |
| --- | --- | --- | --- |
| `miner` | `miner` | `127.0.0.1:19901` | `127.0.0.1:19911` |
| `merchant` | `merchant` | `127.0.0.1:19902` | `127.0.0.1:19912` |
| `customer` | `customer` | `127.0.0.1:19903` | `127.0.0.1:19913` |

Each datadir is `.runtime/lab/<node-id>/`; each cookie is beneath `devnet-atlas-local-v1/.cookie`. Runtime files remain ignored by Git and are not public artifacts. The customer wallet's keys reside only in the customer node's wallet. The merchant and miner wallets do not own the customer's addresses.

P2P is enabled for this lab, with DNS, fixed seeds, discovery, Tor listeners, port mapping and automatic connections disabled. Startup creates a directed triangle with explicit `addnode ... onetry` loopback targets. There are no Internet peers. Guards check the exact named-devnet identity, loopback peer addresses, exact outbound destination ports and the peer's advertised devnet name. Incoming TCP source ports are ephemeral; their UI `nodeId` may be null. Peer advertisements are not authenticated operator identities.

The read-only dashboard uses **separate credentials**, stored in `.runtime/lab/dashboard/<node-id>.json`. The daemon enforces a whitelist containing only `getblockchaininfo`, `getnetworkinfo`, `getpeerinfo` and `getblockhash`. Requests to spend, stop a node or read its wallet are rejected by Dash itself. The dashboard status module never reads administrative cookies or wallet keys.

Administrative scripts use cookie authentication. `rpcwhitelistdefault=0` preserves cookie administration while explicit dashboard users stay restricted. This is a method boundary, not an OS security boundary: all processes run as the same operating-system user, which can read these local files. Separate machines/users or a hardened signer are still required for production separation.

## Pinned laboratory parameters

| Parameter | Value | Reason |
| --- | --- | --- |
| `minimumdifficultyblocks` | `10000` | Keep the initial lab range inexpensive to mine on CPU |
| `highsubsidyblocks` | `1` | Permit the built-in devnet genesis reward at height one |
| `highsubsidyfactor` | `1` | No reward multiplier |

On a fresh 23.1.8 named devnet, the upstream default `highsubsidyblocks=0` caused height one to fail validation: its built-in 50 DASH coinbase exceeded the default 5 DASH allowance (`bad-cb-amount`). Setting `highsubsidyblocks=1` retains the historical allowance for that genesis block alone. Actual integration checks verify height one's output is 50 test DASH and height two's total coinbase output is the normal 5 test DASH. Genesis's OP_RETURN output is unspendable. All three nodes use identical parameters, recorded in `.runtime/lab/manifest.json`. This workaround is a local test configuration, not proposed mainnet tokenomics.

## Test funding and retry behavior

Startup funds the customer with 20 test DASH when its trusted plus untrusted-pending balance is below 5; it funds the merchant with 2 when that sum is below 1. It mines 110 maturity blocks only if funding is required and the miner lacks the total amount plus a small fee reserve. A final block confirms known pending funding. A repeat start of an already funded lab does not create extra blocks.

Funding writes a durable pending operation record before sending. A response lost after dispatch leaves an uncertain operation in `.runtime/lab/funding.json`; startup refuses a blind resend. Inspect the miner transaction comments and recipient wallet before resolving that record manually. A confirmed lack of funds can also require manual inspection after a failed send; this conservative behavior avoids duplicate test payments.

Wallets are unencrypted development fixtures. They have no monetary value and must never be repurposed for real funds.

## Module contracts

- `lab/config.mjs`: pinned identity and `NODES`, keyed by `miner`, `merchant`, `customer`.
- `lab/rpc.mjs`: `rpc(nodeId, method, params = [], wallet)` for local CLI administration; `assertLabNode(nodeId)` must run immediately before each mutation. Decimal JSON amounts are preserved as strings using the application's exact decimal parser.
- `lab/status.mjs`: `getLabStatus()` uses only method-restricted dashboard credentials. A synchronized result requires three verified nodes with the same height and best block hash. It returns no cookies, passwords or keys.
- `lab/lifecycle.mjs`: lifecycle and controlled peer/mining functions for the lab's tests and CLI.

## Verification

```sh
node --test tests/lab.test.mjs
node tests/lab-integration.mjs
```

The integration test needs the original regtest node running so it can assert that its tip remains unchanged. It creates real lab blocks and temporarily stops/partitions the merchant node. Run it **serially**, before signer integration tests or other work that mutates this lab. Cleanup reconnects the three nodes and leaves them running.

Checks cover pinned genesis and subsidy, role-wallet separation, actual daemon enforcement of dashboard permissions, idempotent funded startup, block propagation, restart/catch-up and convergence after a partition with competing branches. The generated report is `.runtime/lab/integration-report.json`.

InstantSend, ChainLocks, Dash Platform and masternode quorums are not configured. Three processes controlled by one user do not demonstrate decentralization, attack resistance, production TPS or a safe public launch.
