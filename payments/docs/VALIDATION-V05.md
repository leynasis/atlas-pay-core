# LAVEPAY 0.5 validation — 20 September 2026

This records local execution on macOS 26.1 / Apple Silicon with Node 25.6.1,
Apple Clang 17 and the repository's source-built LAVE Core. Coins have no
monetary value. It is not a public testnet, an independent security audit or a
production performance result.

## Custody migration and preservation

- The existing three-node LAVE network became four nodes: miner, watch-only
  cashier, customer signer and separate merchant signer. The cashier reports
  `private_keys_enabled=false`; a real funded PSBT cannot acquire a signature
  from it. Descriptor wallets can still report `ismine=true` for tracked
  scripts, so that field alone is not a private-key custody test.
- Migration preserved all four pre-existing invoices and the merchant balance
  of `2.30999775 LAVE` at migration time. The original merchant wallet and its
  native backup remain under the private signer migration directory; the
  private wallet is no longer in the cashier data directory.
- Repeating startup/migration did not mine blocks or rewind descriptor indices.
  The original height-122 block remained canonical after all payment tests.
  Historical invoice `faf6acf8-778e-4aa5-b1c0-65439008538a` remains paid with
  transaction `9906e2f2f904f6aee65319995069cad36ad47d6dd97a6901bf7b5ec5121e23d0`.
- The separate Atlas chain and legacy regtest retained their original tips.
  The concurrently developed MOVE application uses distinct `move-*` wallets
  on the miner. These were preserved; its later test mining legitimately
  advanced the shared LAVE chain. Partition/restart tests were coordinated
  with that task while its network mutations were paused.

## Automated and live checks

| Check | Observed result |
|---|---|
| JavaScript unit and HTTP tests | 68 passed in each selected LAVE/Atlas environment, including seven masternode snapshot tests |
| Selected native Core suites | 24 test cases passed; full 720-case suite not run |
| Native binary/live verification | 18 checks passed: build hashes, network guards, four descriptor wallets, genesis and address separation |
| HTTP payment and refund | 11 checks passed with the cashier running inside macOS Seatbelt |
| PSBT signer integration | 8 checks passed, including lost-response recovery with the same signed transaction |
| Payment-network integration | 9 checks passed, including relay, restart/catch-up, partition/reorg and preservation of legacy chains |
| Watch-only migration | Real PSBT signing fails; history/originals preserved; repeated import cannot rewind addresses; mining credential rejects spend, export and stop |
| Cashier OS confinement | 14 live checks passed: protected file reads, writes, symlink/hardlink access, forbidden subprocess, inherited Node sandbox and blocked wallet/network ports |
| Native backup recovery | Six checks passed on fresh isolated nodes, described below |
| Live encrypted HTTP exports | Both customer and merchant archives decrypted in memory and matched the pinned LAVE wallet format; throwaway test archives were not retained |
| Foreign wallet rejection | Actual official Dash descriptor backup rejected by LAVE's SQLite network application ID |
| Frontend | Production build passed; network/backup UI inspected; backup form at 390 px had no horizontal overflow |
| Formatting and repository lint | Prettier and required upstream lint runner passed; optional codespell, vulture, cppcheck, flake8 and shellcheck were unavailable and skipped |

The signer integration check accepts either miner mempool presence or proof
that the transaction already entered the miner's active chain. This avoids a
false timeout when another local application confirms a transaction between
broadcast and observation. It still checks the actual transaction ID and
merchant receipt independently.

## Backup and recovery evidence

The native test starts two empty nodes on RPC 20181/20182 with P2P disabled,
manually relays blocks, and restores an actual Core descriptor wallet plus
its SQLite signing journal. Both start at height 1 and finish at height 112;
neither connects to the running payment lab.

After a simulated lost broadcast response, the restored signer rebroadcasts
the exact saved transaction: one original signature, zero recovered funding
calls, zero recovered signatures and one retry of the same raw bytes. Both
nodes confirm a single `0.25 LAVE` payment. Wrong passwords, altered/truncated
archives, oversized or modified KDF parameters, foreign roles/chains/wallet
formats, unfinished signing states and concurrent mutation are rejected.

Every restored journal is `RECOVERY_LOCKED`: new preparations and signatures
remain disabled. An older backup cannot know operations performed after its
timestamp. This version supports inspection and recovery of already signed
transactions; it does not provide automatic resumption of new spending from
an old snapshot. The working wallet files and preserved migration originals
are not encrypted by the archive feature.

## Native build provenance

The final native source-content digest is
`a5616932a81de43248fed321cede62cc38305193d3256bb1cbb8511e13b78b3e`.
Both builds retain upstream Dash v23.1.8 at
`728f5055836c6d29806412fc7223ac8fe05af991` as their baseline. The local ignored
build manifest records compiler/configure inputs and binary hashes. Test
results validate this local build, not independent binary reproducibility.

## Real masternode proofs and outage recovery

Final run `d6770fd9-521a-4a5b-9651-758f4b566101` completed successfully at
`2026-09-20T06:14:08.846Z`. Eight registered/enabled masternodes and a controller
formed upstream test quorums through real DKG: three members / two signatures
for ChainLocks, and two rotated four-member / three-signature InstantSend
quorums. These intentionally small laboratory parameters are not production
parameters.

- Baseline InstantSend transaction
  `aaaabd2ba518d7aa496e3b21d049bae15b0b1e544edec4b95dbbddfe59831c7d`
  and ChainLock height 2561 had cryptographically verified BLS proofs observed
  on all nine nodes. Altered transaction/block hashes failed verification.
- Stopping all eight masternodes for 12,113 milliseconds produced no fresh
  InstantSend proof and no ChainLock for the new height-2562 block.
- Recovery checked that the actual outage transaction had confirmations and
  ChainLock protection, then verified a fresh InstantSend proof for
  `3be3ff6eb1555afb47d897af739bb3b5e0fc299401ff22cce8dbffd81ca4a8fb`
  and a fresh ChainLock at height 2565 on all nine nodes.

Recovery waits for masternode synchronization and authenticated quorum links.
The controlled test clock advances past the inherited ten-minute block-filter
timeout before settling the outage transaction. An old transaction protected
by a later ChainLock is not counted as having its own InstantSend signature.
The test verifies fresh signing separately; it changes no signature or
consensus algorithm. The public ignored runtime report contains the full
signatures and observations. A twelve-second outage with one local operator
does not establish Byzantine resilience or sustained network availability.

## Scope

Payment-chain InstantSend and ChainLocks remain disabled. LAVE-Q is a separate
masternode experiment; see [its network and proof procedure](MASTERNODES.md).
Customer/refund wallet processes and the host owner remain trusted. The
cashier sandbox does not add owner authentication, protect against the host
administrator or create customer-owned devices. Public deployment, independent
operators, authenticated merchant requests, hardware custody, safe resumption
after stale-backup reconciliation and fiat settlement remain separate work.
