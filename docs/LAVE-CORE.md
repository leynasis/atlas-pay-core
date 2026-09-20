# LAVE Core local chain v1

LAVE Core v0.4 is a source-built development fork of Dash Core 23.1.8. The
native version remains 23.1.8 so upstream protocol compatibility is explicit;
the client user agent is `LAVE Core`. Copyright and license notices are retained.
This is a local test currency with no monetary value. It is not a public testnet
or a production monetary network.

The shipped daemon and RPC client accept only an explicit
`-devnet=lave-local-v1`. Omitting the network, selecting Dash mainnet/testnet/regtest,
using `-chain=devnet`, or selecting another devnet is rejected before the daemon
initializes chainstate or the CLI sends an RPC. Upstream parameter constructors
remain available to native unit tests; this does not enable those networks in
the shipped executables. Help and version commands work without a network flag.

## Pinned identity

| Parameter                              | LAVE local v1                                        |
| -------------------------------------- | ---------------------------------------------------- |
| Command-line devnet                    | `lave-local-v1`                                      |
| RPC chain and data subdirectory        | `devnet-lave-local-v1`                               |
| P2P message magic                      | `fa4c56b9`                                           |
| Default P2P / RPC / onion target ports | `19779` / `19778` / `19776`                          |
| Reserved Platform P2P / HTTP ports     | `22170` / `22171`                                    |
| P2PKH / P2SH Base58 version            | `48` (`L`) / `63`                                    |
| WIF version                            | `181`                                                |
| BIP32 public / private version         | `024c5055` / `024c5052`                              |
| BIP44 coin type                        | `1` (test networks; no mainnet registration claimed) |
| Signed-message domain                  | `LAVE Signed Message:\n`                             |
| Configuration / PID filenames          | `lave.conf` / `laved.pid`                            |
| macOS / Windows data directory         | `LaveCore`                                           |
| Unix data directory                    | `~/.lavecore`                                        |

The three-node application lab overrides the default ports with separate
loopback ports. Its profile also uses separate data directories, descriptor
wallets, invoice databases and signer journals. Existing Dash binaries, keys,
chainstate and historical invoices are not migrated or relabelled as LAVE.

Both genesis blocks are deterministic and asserted in `src/chainparams.cpp`.
Their X11 proof-of-work hashes were computed using the repository's X11 sources.

| Field       | Height 0                                                           | Height 1                                                           |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Version     | `1`                                                                | `4`                                                                |
| Timestamp   | `1789862400` (2026-09-20 00:00:00 UTC)                             | `1789862401`                                                       |
| Bits        | `207fffff`                                                         | `207fffff`                                                         |
| Nonce       | `1`                                                                | `0`                                                                |
| Hash        | `28fae923c5ef15cb623f14f61aae383050712a8ef7ff740bb2b1541d8a3bcf9c` | `2043af4ec0030900338e8ad5eb86428008787d4be468f197d2bcd1776c094209` |
| Merkle root | `4b5a3ecc7369c447d5521c3a40999459245917c4505aa84dc9b5cb06e9bf0b6c` | `d4abdb42f52681bab0d03e1935d139211284e65c6419afc7490560c1ffa07ac7` |

Height 0 commits to the UTF-8 text
`LAVEPAY 20/Sep/2026 LAVE local development network - no monetary value`.
Height 1 commits to `devnet-lave-local-v1`. Both coinbases use an unspendable
`OP_RETURN` output of 50 units, so neither assigns spendable launch coins.
Fresh test wallets are funded by subsequent mined blocks.

## Consensus and authority boundaries

X11, transaction serialization, difficulty algorithms, subsidy calculations and
quorum algorithms remain upstream. This profile fixes `minimumdifficultyblocks`
to 10000, `highsubsidyblocks` to 1 and `highsubsidyfactor` to 1. The height-1
bootstrap allowance is necessary for the named devnet coinbase; its factor is
one, not an increased reward multiplier. These are development values, not a
final issuance policy. The ordinary devnet difficulty rules resume after the
initial minimum-difficulty window.

Altered subsidy/difficulty values and quorum/spacing overrides are rejected.
There are no DNS seeds, fixed peers, inherited spork signing addresses or local
spork private keys. A spork manager with no authorized keys rejects updates and
keeps upstream default spork values. `-sporkaddr`, `-sporkkey` and
`-minsporkkeys` overrides are rejected. No masternode network has been provisioned;
InstantSend, ChainLocks and Platform must not be advertised as operational.

Public peer discovery, inbound listening and onion listening default off in the
daemon. The application lab explicitly enables only its configured loopback
listeners and peers. The executable is not an OS sandbox: manually changing
network options can expose the development chain, which is not a deployment
procedure.

## Wallet and replay boundaries

Native address, WIF and BIP32 decoding rejects Dash encodings. Descriptor wallets
use SQLite's `application_id` tied to the chain message magic; a copied Dash
SQLite wallet therefore fails wallet format/network validation. The supported
build disables Berkeley DB and creates fresh descriptor wallets. It must not
reuse Dash wallet directories or seeds.

The new genesis creates an independent UTXO history, so an ordinary Dash payment
cannot spend its Dash inputs on LAVE. This is not a change to the transaction
signature-hash format and is not universal replay protection for deliberately
reused keys or deliberately duplicated UTXOs. Signed messages use a separate
LAVE prefix. The payment application additionally verifies the exact chain name,
height-0 hash and height-1 hash before preparing or signing.

## Build and provenance

The supported application build uses Autotools. On macOS, install Xcode Command
Line Tools and the native dependencies first; CMake is not required:

```sh
brew install automake libtool boost gmp pkg-config libevent
cd payments
npm ci
npm run core:build
```

The compiler also needs SQLite headers/libraries. If Boost is outside the
compiler's normal search path, set `LAVE_BOOST_PREFIX` to its installation prefix
for `core:build`. Other operating systems need equivalent development packages;
see the upstream platform build guides. `LAVE_BUILD_JOBS` controls parallelism
and defaults to at most four jobs.

The script configures an out-of-tree build in
`payments/.runtime/lave-core/build` with `--with-gui=no --without-bdb
--with-sqlite=yes --disable-stacktraces` and other options recorded in its
manifest. It installs `laved` and `lave-cli` in
`payments/.runtime/lave-core/bin`. Build provenance is stored in
`payments/.runtime/lave-core/build.json`, including source and binary hashes,
compiler, dependencies and configure options. Lab startup checks the installed binary against its build manifest before launching it. This is traceable local build evidence, not a
claim of independently reproduced or audited release binaries.

After building Core, from `payments/`:

```sh
npm run lab:start
npm run core:verify
npm run build
npm start
```

`core:verify` requires the three LAVE nodes running: it checks binary hashes, CLI network guards, chain identity, new LAVE addresses and descriptor wallets. Run `npm run core:test` for the selected native unit suites after building.

The full profile checks include `npm run test:wallet-isolation`. Its negative wallet-format fixture needs the separate official Dash runtime (`npm run network:install`); normal LAVE startup never uses that runtime. Run live
integration suites serially; they create development-chain state. The Atlas
profile uses the old official Dash binary rather than these LAVE executables.

## Native validation

`src/test/lave_params_tests.cpp` registers the `lave_params_tests` suite. It checks
both pinned hashes and proofs of work, linkage, unspendable bootstrap output,
magic/ports/no authorities, rejection of Dash addresses/WIF/BIP32 keys, and
rejection of unsupported network/consensus/authority flags. Existing amount and
signed-message tests are updated for the LAVE unit and signing domain. Existing
PoW and versionbits fixtures explicitly select the pinned LAVE devnet when they
exercise development-chain parameters.

After building the native test target:

```sh
# From the repository root, using the out-of-tree application build:
make -C payments/.runtime/lave-core/build/src -j4 test/test_dash
payments/.runtime/lave-core/build/src/test/test_dash --run_test=lave_params_tests,amount_tests,pow_tests,versionbits_tests
payments/.runtime/lave-core/build/src/test/test_dash --run_test=util_tests/message_sign
src/test/test_dash --run_test=util_tests/message_verify
src/test/test_dash --run_test=util_tests/message_hash
```

The executable target names remain `dashd`, `dash-cli` and `test_dash` in the
upstream build graph; the application build script installs the first two as
`laved` and `lave-cli`. A successful native build, the selected unit suites and
the live payment/refund/isolation checks should be recorded separately. A source
change or a web build alone is not evidence that LAVE Core ran.
