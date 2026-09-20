# Local LAVE-Q masternode laboratory

This laboratory runs eight real deterministic masternodes and one controller on this computer. It registers ordinary masternodes with 1,000 test units of collateral each, forms BLS quorums through the upstream distributed key generation protocol, and verifies actual InstantSend and ChainLock signatures through Core RPC.

It is an isolated development network, not the payment network and not a public launch. The display unit **LAVE-Q** has no monetary value. Eight processes controlled by one operator do not provide decentralization. The small test quorums are unsuitable for production security claims.

## Run it

From `payments`, after `npm run core:build`:

```sh
node masternodes/index.mjs start
node masternodes/index.mjs status
node masternodes/index.mjs verify
node masternodes/index.mjs mine 1
node masternodes/index.mjs stop
```

`start` creates only `.runtime/masternodes`, mines fresh test funds, creates a descriptor controller wallet and BLS operator keys, registers eight masternodes, connects them locally and mines paced DKG cycles. Initial funding requires approximately 2,400 blocks with the inherited emission and maturity rules; rotation then needs historical DKG quarters. Allow several minutes. Subsequent starts reuse the same wallet, keys, registrations and chain.

`verify` submits a signed local test payment, waits for a real InstantSend lock, verifies its BLS signature with `verifyislock` and checks propagation to all nine nodes. It mines a block, verifies its ChainLock with `verifychainlock`, and rejects proofs paired with different transaction/block hashes. It then stops all eight masternodes, observes the absence of fresh locks for at least twelve seconds, restarts the masternodes, waits for authenticated quorum connections, confirms the outage payment after advancing the test clock through the existing ten-minute safety window, and verifies fresh ChainLock and InstantSend proofs. This bounded outage test establishes dependency on quorum participation; it is not a Byzantine-fault or production load test.

`mine` advances only this test chain and its shared mock clock. `stop` stops only these nine daemons and the public status monitor; data remains for restart. Keep the laboratory stopped when it is not needed.

## Fixed network identity

| Parameter               | LAVE-Q laboratory                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| Explicit flag           | `-devnet=lave-quorum-v1`                                           |
| RPC chain               | `devnet-lave-quorum-v1`                                            |
| Genesis block 0         | `3db65802980f975c71d3c4e095a0d45304b4e419a09fd2182aee54cb3eaed4de` |
| Named devnet block 1    | `4d77c6b3447becea615bebe369a6771937d6d2722baf99060f9704f7b112a4e1` |
| P2P message magic       | `fa4c51b9`                                                         |
| Address prefixes        | P2PKH 49; P2SH 64; WIF 182                                         |
| BIP32 versions          | public `024c5155`; private `024c5152`                              |
| Default Core ports      | P2P 19789; RPC 19788                                               |
| Actual controller ports | RPC 20101; P2P 20111                                               |
| Actual masternode ports | RPC 20102–20109; P2P 20112–20119                                   |
| Runtime                 | `payments/.runtime/masternodes`                                    |

RPC and P2P listeners bind to `127.0.0.1`. DNS seeding, fixed seeds, discovery, Tor listening, UPnP and NAT-PMP are disabled. The controller uses `connect=0`; masternodes must leave `connect` unset because upstream Core disables its masternode connection worker whenever `-connect` is supplied. They discover quorum peers from the locally registered deterministic list. Every lifecycle mutation checks both genesis hashes and rejects observed non-lab peers.

The v0.6 `lave-local-v1` payment chain has its own [wallet-managed masternodes](WALLET-MASTERNODES.md). Its addresses, genesis and quorum parameters remain unchanged; its local activation policy now enables the same six features. The old Atlas/Dash laboratory is also separate. Core accepts only the two explicit LAVE devnet names; Dash mainnet, testnet and regtest remain refused.

## Quorums and activation

| Feature             | Upstream test type        | Size | Minimum members | Signing threshold | Active quorums |
| ------------------- | ------------------------- | ---: | --------------: | ----------------: | -------------: |
| ChainLocks          | `LLMQ_TEST` / 100         |    3 |               2 |                 2 |              2 |
| Rotated InstantSend | `LLMQ_TEST_DIP0024` / 103 |    4 |               4 |                 3 |              2 |

Cycles span 24 blocks. The launcher waits for authenticated quorum connections and real contribution/commitment messages; it does not inject quorum commitments or fabricate signatures. Eight distinct operator keys provide the population for the two rotating quorums. The Platform test quorum type is present in Core parameters, but no Platform service or EvoNode is deployed or claimed.

Both explicitly named local LAVE profiles have fixed activation of SPORK 2 (InstantSend), 3 (InstantSend block filtering), 17 (DKG), 19 (ChainLocks), 21 (all quorum members connected) and 23 (PoSe). There is no spork authority key. Superblocks remain disabled. Only the LAVE-Q profile permits a test mock clock; both profiles permit loopback masternode services. No PoW, emission, BLS, DKG or signature algorithm is replaced.

## Status and credentials

The lab-owned monitor reads its dedicated RPC cookies and publishes a sanitized snapshot every three seconds to `.runtime/masternodes/public/status.json`. The payment web service reads only that public snapshot via `getMasternodeStatus()`, and never imports administrative lab RPC credentials. Snapshots older than fifteen seconds are marked stale and cannot advertise verified capabilities. A ChainLock object is an observed signature for its stated height; it must not be interpreted as protection for another chain or a newer block.

Verification results are in `.runtime/masternodes/public/verification.json`, including proof hashes, public BLS signatures, observations on all nine nodes, outage duration and recovery results. The dashboard clearly labels this as LAVE-Q; it must never use these proofs to label an ordinary LAVE payment as InstantSend or ChainLocked.

The controller wallet, BLS operator files, RPC cookies, configs and mutation journals are private local runtime files. Operator keys are written to mode-600 files and never passed in process arguments. Signed test transactions are journaled before broadcast so retries can rebroadcast the same transaction. Funding outputs are reserved while registrations are prepared. Runtime files are ignored by Git; do not commit them or publish wallet/operator secrets.

## Verification limits

Native `lave_params_tests/isolated_quorum_identity_and_activation` pins genesis and PoW, message magic, address/key separation, quorum parameters and the profile-scoped activation policy. The live proof test exercises the source-built binary and real P2P/RPC state. These checks do not establish public-network security, scalability, adversarial consensus resilience, independent validator operation or readiness for valuable assets. A public testnet requires a separately reviewed network specification, realistic quorum population, independent operators, key custody and recovery design, monitoring and sustained fault/security testing.
