# LAVEPAY 0.6 validation — 20 September 2026

Local execution used macOS 26.1 / Apple Silicon, Node 25.6.1, Apple Clang 17
and the repository's source-built LAVE Core. All LAVE in these checks is
valueless local test currency. This is not a public network, an independent
security audit or a production performance measurement.

## Existing data preserved

Read-only checks confirmed both pinned LAVE genesis hashes and these historical
canonical blocks:

- Height 122: `2097133a11a5b59ffa12050e3a6daacf9458ce8738c36da55617d7e9ada8dbce`.
- Height 370: `2e814592f2f881b6a2527397379e1afcefdb5d4b395b7ec00539b062c8d84902`.

Original invoice `faf6acf8-778e-4aa5-b1c0-65439008538a` remained paid by its
original 0.05-LAVE transaction
`9906e2f2f904f6aee65319995069cad36ad47d6dd97a6901bf7b5ec5121e23d0`
in block 122. All five `move-*` wallets remained loaded and present on disk.
The separate Atlas miner, merchant and customer retained height 142 and hash
`5a1d17f24ef13c65647600bd9caa208bc77a6b7f432e073fe6ef09b74b4bd588`.
Legacy regtest retained height 120 and hash
`5bdd2cbe6610cefd6c31d9c667b21a3c7a05abee09d224f5e42c29e45fad86a7`,
with networking inactive and no peers.

## Wallet collateral and approvals

The customer wallet UI created `LAVE Home` with a real 1000-LAVE collateral
transaction. A separate review approved its native ProReg transaction, including
the fixed local service address, payout address and additional registration fee.
The browser never receives the operator secret. Missing or changed approval
fingerprints are rejected; an actual HTTP request without a fingerprint left
the customer draft unsigned.

The customer node reached native `READY` with actual masternode synchronization,
14 handshaken peers and the same chain tip as its wallet. The UI showed one active
node and 1000 locked LAVE. Its collateral transaction is
`1f414eeb0fdcb4de48e2a943d261e3bab2ae78d6bf632c853eb50f2450346d56`;
registration is `c962a207e8c40489a1540b712a30cda6270cac575b2b14e1da32bf8192afe1ef`.
The first observed reward was **1.875 LAVE**, output 2 of native coinbase
`bbe37726801f7d9fa0a4e3877bdeb089c2d4cd1ce8fce8429eed974c25325acd`.
Core classified it as immature and the UI displayed it separately from mature
rewards and spendable balance. Expanded node details at a 390 px viewport had
no horizontal overflow; the temporary viewport override was reset.

The merchant integration exercised insufficient funds without automatic funding,
unsigned collateral preparation, an injected lost broadcast response and retry
of the same saved transaction without a second signature. Normal payment
preparation excluded the reserved collateral. Native `register_prepare` returned
unsigned inputs; `register_submit(..., false)` produced signed bytes absent from
the mempool until the application had durably journaled and broadcast them.

An independent native restart check paused both the merchant integration and
merchant HTTP wallet so application reconciliation could not mask the result.
With **zero registered masternodes**, the private signer was stopped and restarted.
Its 1000-LAVE collateral output
`796b238319ea6fefcb287cb8dfdcd605da212fc105f8c01c5c95f9f02968de15:1`
remained in `listlockunspent` and unspent at its original amount. The signer was
then reconnected to the preserved payment network.

The live integration exposed an interaction with invoice accounting: Core's
ProReg fee funding returns change to its funding address. Choosing an old invoice
address therefore produced a self-transfer that the cashier initially counted
as another receipt. Registration now requires an owned internal change address.
The cashier also excludes a receive output when Core identifies that exact
address/output index as wallet-sent. After normal HTTP reconciliation, the original
invoice again reported exactly `0.05` received and confirmed, `overpaid=false`,
and its original payment transaction. No historical transaction or database row
was manually rewritten. Regressions preserve genuinely separate incoming payments.

The first live immediate stop/start attempt exposed a Core shutdown race: RPC
cookies disappear before the process has released its data-directory lock.
Managed stop now waits for the captured process to exit, the PID file to disappear
and RPC to become unavailable before allowing restart. It never kills a process.
Regression checks cover premature cookie removal and a still-running process.

After that fix, the original registered merchant node completed clean restart
and retirement without repeating its collateral or registration signatures.
A fresh full run with the final code then passed **8/8 live checks**, including
native internal-change fee selection and an actually synchronized `READY` node.
All four recovery/new-run transactions obtained verified InstantSend signatures
before mining and confirmed in ChainLocked blocks 6262–6265. The final retirement
is `f8b4789c11bb8b9cbd4e09ee695b2a1dc03ae595a57b9c619766d5fd2c5c4e22`
in block `20a1b21015c435d181e797641914280d54e2a495a109c1edc47e139a7358dec4`.
The merchant node finished retired and offline, removed from the deterministic
list, with zero locked collateral and no pending review. Reports are under
`.runtime/lave/staking/`; full signature evidence for these four confirmations
is `.runtime/lave/payment-masternodes/merchant-confirmation-window.json`.

The customer HTTP backup decrypted successfully in an isolated temporary check
and contained the matching wallet, collateral journal and operator key inside
the encrypted archive. The merchant integration separately restored its native
wallet and journal and verified that the operator key survived while new actions
remained `RECOVERY_LOCKED`. No plaintext operator secrets or test passwords were
published or retained as test artifacts.

## Automated checks and build

| Check | Observed result |
| --- | --- |
| JavaScript unit and HTTP tests | 133 passed in each selected LAVE/Atlas environment |
| Selected native Core suites | 25 cases passed; full 721-case suite not run |
| Native binary and live verification | 18 checks passed |
| Wallet masternode integration | 8/8 live checks passed on final code, plus insufficient-balance preflight and independent native restart persistence check |
| PSBT signer integration | 8 live checks passed, including exact signed-byte recovery after a lost response |
| HTTP payment and refund | 11 live checks passed with cashier OS confinement and customer collateral still locked |
| Cashier OS confinement | 21 live checks passed, including actual managed-node configuration and seed journal protection |
| Frontend | Production build passed; desktop and 390 px wallet layout inspected |
| Formatting and repository lint | Prettier and required upstream lint runner passed; optional codespell, vulture, cppcheck, flake8 and shellcheck were unavailable and skipped |

The native source-content digest is
`e7d395a6862f90611ab9763b0de5ceb8f357aec7861012591fe9ff164e6a7644`.
The upstream baseline remains Dash v23.1.8,
`728f5055836c6d29806412fc7223ac8fe05af991`. The ignored local build manifest
records compiler/configure inputs and binary hashes. These checks validate this
build; they do not establish independent binary reproducibility.

## Payment-chain quorum evidence

Run `f7c90965-18a5-4212-bd87-0cda104b7997` completed successfully at
`2026-09-20T11:20:58.653Z` on the preserved payment chain. Sixteen seed masternodes
formed genuine DKG commitments with unchanged parameters: 12 valid members for
ChainLocks and two rotated InstantSend groups with 8 valid members each. Earlier
rotation quarters correctly had fewer members; the final proof waited for the
full groups. The operator waits only on actual active-session participants and
does not treat completed prior-cycle sessions as missing current connections.

- Fresh InstantSend transaction
  `4e66ed296e6cf8eb0e398e0d8d439d254c74f307b3f7b2917934ce35fea59e60`
  had a cryptographically verified BLS lock observed on all twenty known base
  and seed nodes. Changing its transaction ID invalidated the signature.
- Its containing block at height 6261,
  `5dde7b640517060b5f6c92d5360aa21d77ce9ddc1a3b68b4aa1af71b2ead1a73`,
  had a verified ChainLock observed on all twenty nodes. Verification rejected
  the same signature for a different block hash.
- Actual coinbase payouts were proven for all sixteen seed masternodes. The
  public report is `.runtime/lave/payment-masternodes/public/verification.json`.
- The production UI displayed both verified capabilities and this actual
  ChainLock independently from the separate LAVE-Q section. The public monitor
  requires current authenticated quorum connectivity; stale snapshots or an
  RPC-reachable isolated process cannot establish signing availability.

The shared payment network was not interrupted for an all-masternodes-offline
test. That separate recovery experiment remains recorded in the v0.5 LAVE-Q
report and is not claimed as payment-chain evidence.

Activating the inherited block filter exposed a payment-orchestration race:
the miner can receive a transaction before its InstantSend lock. An initial
checkout test therefore mined an empty block and correctly left the invoice
`detected`. Development mining now waits for exact native lock readiness or
eligible age, and separately verifies actual confirmations after mining. The
signer integration also waits for eligibility. No spork or clock was bypassed;
the originally pending test payment later confirmed in a normal block.

The final HTTP run passed all eleven checks. Its harness retries only the explicit
pre-mining `PAYMENT_NOT_MINEABLE` response within a bounded 90-second window; an
unexpected conflict or failed post-mining confirmation still fails the test.
After checkout and refund, the customer node remained `READY`, synchronized with
15 peers at height 6270; its exact collateral output remained unspent and locked
at 1000 LAVE. The network reported 17 registered/enabled masternodes and both
verified capabilities. The original invoice still showed exactly 0.05 received
and no overpayment. Shared-network mutation ownership was returned to the paused
MOVE task after all these checks.

## Scope and operational limits

The wallet manages one local ordinary masternode per role. Stopping its process
keeps collateral reserved; withdrawal requires a separately reviewed spend.
The reservation is a persistent wallet lock and network eligibility rule, not a
consensus timelock. The private-key owner can spend through another tool.
Replacement after retirement waits for an actual ChainLock; prior operator
metadata remains available until then.

The existing payment-chain quorum sizes, genesis hashes, PoW, emission and real
clock were retained. Initial unlocked transactions waited through the inherited
600-second block-filter rule. No mock-time or filtering bypass was used.
The separate LAVE-Q experiment and its proofs remain separate from payment LAVE.
Invoice settlement still requires a block confirmation.

All processes share one computer and operator. Public deployment, independent
operators, customer-owned devices, production authentication, hardware custody,
stale-backup reconciliation and fiat settlement remain further work.
