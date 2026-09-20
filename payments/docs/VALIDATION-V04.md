# LAVEPAY 0.4 validation

Validated on 20 September 2026 on macOS ARM64 with Apple Clang 17 and Node
25.6.1. These results concern the local `lave-local-v1` development network.
They do not establish production readiness, public-network performance or
independently reproducible binaries.

## Source-built Core

`npm run core:build` compiled this repository's modified Dash 23.1.8 sources
and installed `laved` and `lave-cli` in `payments/.runtime/lave-core/bin`.
No official Dash executable was substituted for LAVE. The private local
`build.json` records configure flags, compiler, dependency versions, native
source digest and both binary SHA256 hashes. Startup verifies the daemon
against that manifest. Both staged binaries are validated before installation;
an interrupted install cannot pass the manifest check.

Native source SHA256 for this validation:
`81334cba18ee5f9e7145f80f61b3dc1e3ae866a6a4b642b6af074d57cdf21252`.

| Check | Result |
| --- | --- |
| `npm run core:test` | 23 selected native test cases passed; 57,650 assertions in this run |
| Vendored `dashbls/runtest` | 17 BLS cases, 1,413 assertions passed |
| `npm run core:verify` | 17 live/binary checks passed |
| `npm test` | 53 unit and HTTP tests passed |
| `npm run test:integration` | 11 checkout checks passed |
| `npm run test:signer` | 8 live signing checks passed |
| `npm run test:lab` | 9 live network checks passed |
| `npm run test:wallet-isolation` | Actual Dash descriptor backup rejected by LAVE |

The selected native suites cover genesis hashes and proof of work, encodings,
runtime network guards, amount formatting, difficulty rules, versionbits and
signed-message domains. The full 719-test upstream native suite and upstream
functional regtest suite were not run. Native build artifacts and reports are
ignored by Git.

## Runtime evidence

- A fresh LAVE profile created three independent descriptor wallets, connected
  only to the configured loopback peers and synchronized to height 112 after
  initial funding. Both pinned genesis hashes matched.
- Missing network selection, Dash mainnet/testnet/regtest, a foreign devnet and
  conflicting network flags were rejected by daemon and CLI. Verification
  exposed an early-shutdown crash on conflicting flags; both entry points now
  catch configuration errors before uninitialized shutdown, and verification
  passed after rebuilding.
- The merchant API's real Core credentials were denied spending, signing and
  private-key export. Dashboard credentials were denied wallet reads and
  state-changing methods. Customer approval and merchant refund approval used
  separate signing wallets.
- Actual payments and refunds propagated between nodes and were confirmed.
  Repeated approval retained the same transaction. A lost broadcast response
  recovered from SQLite using the original signed bytes without a second spend.
- Restarted nodes caught up. After a partition, the shorter branch was replaced
  by the common chain. Repeated startup did not generate extra funding blocks.
- A fresh, isolated official Dash regtest process created a descriptor backup.
  That same backup restored successfully in Dash, then LAVE rejected it with
  `-18` before loading the wallet. SQLite application IDs differed:
  Dash regtest `fcc1b7dc`, LAVE `fa4c56b9`. Existing wallets were unchanged;
  the temporary process and private backup files were removed.
- All three application processes were restarted after a confirmed browser
  payment. The paid invoice, `0.05` received/confirmed amount, original review
  fingerprint and exact transaction ID were restored without a new signature.
- Original Atlas nodes remained at height 142 with their original common tip;
  the original regtest remained at height 120 with its original tip throughout.

## Browser and remaining boundaries

The updated interface first displayed the old Atlas profile as DASH, then the
new profile as LAVE. A browser-created `0.05` LAVE invoice was reviewed in the
separate customer wallet, explicitly signed, observed in the mempool and
confirmed by a test block. The review displayed recipient, LAVE amount, fee and
change. At a 390-pixel wallet viewport there was no horizontal overflow; the
temporary viewport override was reset. No browser console errors were observed
on the merchant page. The network screen showed three verified, synchronized
LAVE nodes at height 122 after the checks.

This is three processes on one computer, using valueless test coins. Wallet
services still run under the same OS account. Public deployment, independent
validators, InstantSend/ChainLocks quorum operation, external custody review,
mainnet monetary policy, mobile distribution and real-money payment rails are
outside this validation. Address/genesis separation does not change upstream
transaction signature hashing or claim universal cross-chain replay protection.

The normal formatting and repository lint commands were also run. Optional
codespell, vulture, cppcheck, flake8 and shellcheck tools were unavailable and
reported as skipped by the upstream lint runner.
