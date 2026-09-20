# LAVEPAY four-node payment lab — v0.5

The default LAVE lab runs four role-specific Core processes on **one computer**.
It uses the locally compiled LAVE Core client and the pinned `lave-local-v1`
chain. The explicit Atlas profile retains its original three official Dash
nodes, `atlas-local-v1` history and test-DASH balances. Both are valueless local
experiments. Payment-chain InstantSend and ChainLocks remain disabled.

The separate nine-node [LAVE-Q lab](MASTERNODES.md) exercises masternodes and
quorums on a different chain, with separate ports and state. Starting it does
not activate those features for LAVE invoices.

## Run

From `payments/`, after installing npm and native build dependencies:

```sh
npm run core:build
npm run lab:start
npm run lab:status
npm run lab:mine -- 1
npm run lab:stop
```

See [LAVE-CORE.md](../../docs/LAVE-CORE.md) for the native toolchain. `lab:start`
requires the compiled LAVE binary and verifies its manifest SHA-256/version;
it never substitutes official Dash. It connects the four nodes, verifies chain
identity, loads role wallets, completes the watch-only migration and supplies
test funds when required. Mining accepts 1–110 blocks and waits for
synchronization. Stop preserves data.

To use Atlas, prefix **every applicable command**, including application
startup, with `LAVEPAY_NETWORK=atlas`:

```sh
LAVEPAY_NETWORK=atlas npm run lab:start
LAVEPAY_NETWORK=atlas npm run lab:status
LAVEPAY_NETWORK=atlas npm start
```

Atlas can install the checksum-pinned official Dash binary when missing. Stop
the applications before changing profiles: their 4173/4174/4175 HTTP ports are
shared. The optional legacy regtest API on 4180 has its own unmigrated data.

## Nodes, wallets and state

| Node       | LAVE RPC / P2P | LAVE wallet                        | Atlas RPC / P2P |
| ---------- | -------------- | ---------------------------------- | --------------- |
| `miner`    | 20001 / 20011  | `miner`, private                   | 19901 / 19911   |
| `merchant` | 20002 / 20012  | `cashier`, public descriptors only | 19902 / 19912   |
| `customer` | 20003 / 20013  | `customer`, private                | 19903 / 19913   |
| `signer`   | 20004 / 20014  | `merchant`, private refund signer  | Not used        |

Atlas keeps its original miner/merchant/customer wallets. All listeners use
`127.0.0.1`. LAVE node directories are `.runtime/lave/lab/<node-id>/`; Atlas
keeps `.runtime/lab/<node-id>/`. Cookies live under each node's exact named-chain
directory. Invoice ledgers and signing journals are profile-specific. DASH coins
and invoices are never copied or relabeled as LAVE.

The [network specification](NETWORK-SPEC.md) pins both chain names and both
hashes per profile. A generic `devnet`, label or address prefix is insufficient.
LAVE has distinct genesis, P2P bytes and local address/key encodings; this is not
a universal transaction replay-protection claim.

## Upgrade from the existing LAVE merchant wallet

Stop the three HTTP apps before the first v0.5 `lab:start`. The migration applies
only to LAVE, within its existing chain; it does not migrate Atlas wallets.

1. Record the original merchant's public descriptors and historical receiving-address labels. Back up the private Core wallet before changing its location.
2. Restore that private wallet as `merchant` on the fourth, `signer` node.
3. Create a fresh `cashier` descriptor wallet with private keys disabled on the merchant node. Import public descriptors and labels, rescan history, and verify descriptor identity, historical ownership and matching balances.
4. Unload the original private wallet from the merchant node and move its directory to the signer migration archive. Preserve the invoice database and signing journals.
5. Persist completion. Subsequent starts verify the existing wallets and descriptors without resetting address indexes or replacing keys.

Migration state and private recovery artifacts are under
`.runtime/lave/lab/signer/migration/v05/`: `state.json`,
`original-merchant.dat` and `original-merchant-wallet/`. The backup and original
wallet archive are retained, not overwritten or deleted. They contain private
keys and are unencrypted local files. A new installation creates its signer
wallet first and imports only public descriptors into the cashier.

Only the cashier allocates external invoice addresses. The refund signer uses
internal change addresses and follows the cashier's public descriptor range.
The cashier must report `private_keys_enabled=false`; Core may still classify
tracked descriptor outputs as `ismine=true`. A valid funded PSBT cannot obtain
a signature from that wallet. See `npm run test:cashier`.

## Peers and credentials

P2P is enabled only for explicit loopback peers: a four-node ring for LAVE and
the original triangle for Atlas. DNS/fixed seeds, discovery, Tor listeners,
port mapping and automatic connections are disabled. Guards check the exact
chain identity, peer addresses, configured outbound ports and advertised named
devnet. A bounded unfinished handshake may retry; a wrong nonempty identity
fails immediately. Peer advertisements are not operator authentication.

Dashboard credentials allow only `getblockchaininfo`, `getnetworkinfo`,
`getpeerinfo` and `getblockhash`. Merchant API credentials allow receiving-address
allocation and necessary wallet/transaction reads, including public descriptor
inspection, but no signing, sending, private export or administration. The
separate `miner-api/credentials.json` allows development mining and its required
reads; the cashier never reads a miner admin cookie.

Administrative tools use node cookies. `rpcwhitelistdefault=0` preserves cookie
administration while named limited users remain restricted. On macOS the app
launcher additionally confines the cashier with Seatbelt, denying wallet/admin
files and wallet HTTP access. Signing services and the host owner remain
trusted and unsandboxed. See [SECURITY.md](SECURITY.md).

## Bootstrap, backups and shared state

Both payment profiles use an easy-mining window of 10,000 blocks,
`highsubsidyblocks=1` and `highsubsidyfactor=1`. The height-one allowance permits
the built-in devnet bootstrap block; it does not multiply later rewards or
finalize public token economics. LAVE genesis outputs are unspendable.

Startup funds the customer with 20 test units if trusted plus pending funds are
below 5, and the merchant with 2 if below 1. It mines maturity blocks only when
funding is needed and the miner lacks the amount plus fee reserve, and can mine
a confirmation block for pending bootstrap funds. A sufficiently confirmed and
funded repeat start does not add blocks. Units are LAVE or DASH per profile.

`manifest.json` and a durable `funding.json` journal live in the selected lab
directory. An uncertain send stops blind retry: inspect the miner transaction
comment and recipient before resolving it. Encrypted signing-wallet exports and
fresh-directory recovery are described in [WALLET.md](WALLET.md). Working wallets
and migration archives remain private, unencrypted test fixtures.

The miner may also serve another local task, including LAVEPAY MOVE. Additional
wallets and newly mined blocks are legitimate shared state. Preserve wallets
not owned by this application, and coordinate disruptive tests or node stops.
A successful migration preserving its starting tip is not a claim that the
chain height stays fixed while other work proceeds.

## Verification

```sh
npm test
npm run core:verify
npm run test:cashier
npm run test:isolation
npm run test:backup
npm run test:lab
npm run test:signer
npm run test:integration
```

Run live suites serially: some create transactions/blocks or stop and partition
nodes. The cashier migration check exercises public-wallet custody without
broadcasting or mining. Backup checks use isolated recovery targets. The lab
suite checks existing legacy environments when available; the checkout suite
requires all three HTTP apps. `getLabStatus` calls the selected nodes synchronized
only when all verified heights and tips agree.

Use [VALIDATION-V05.md](VALIDATION-V05.md) for recorded runs. A source edit or old
report does not prove current runtime behavior. Throughput, adversarial
resilience, independent operation and public launch readiness remain unproven.
