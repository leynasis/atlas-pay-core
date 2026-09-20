# LAVEPAY

A local payment system with merchant invoices, QR checkout, separate customer
and merchant signing wallets, and independently checked payment/refund receipts.
Version 0.6 adds **wallet-managed masternodes, persistent 1000-LAVE collateral
reservations and payment-network quorum bootstrap** to the watch-only cashier,
separate signing wallets, encrypted backups and macOS confinement. The four base nodes of the
`lave-local-v1` chain runs LAVE Core built from this repository's source. Its
native test unit is **LAVE**. These coins have no monetary value; no public
mainnet, live payment service or fiat conversion is launched.

```sh
cd payments
npm ci
npm run core:build
npm run lab:start
npm run core:verify
npm run build
npm start
```

Open **http://127.0.0.1:4173**. Applications require Node.js 22.13+; building
LAVE Core requires the native toolchain described in [the build guide](docs/LAVE-CORE.md).
On macOS, the launcher confines the cashier with Seatbelt. Other operating
systems currently require an explicitly unconfined local demo:
`LAVEPAY_ISOLATION=off npm start`. Signing services and the host owner remain
trusted; this is not production custody or customer-device isolation.

Existing LAVE invoices and addresses are retained during the watch-only
migration. The previous Atlas profile is available explicitly with
`LAVEPAY_NETWORK=atlas`, using its original three nodes, Dash binary, test DASH,
wallets and chain data. Switching profiles does not convert or rename balances.

- [Setup and payment walkthrough](payments/README.md)
- [Project scope and upstream baseline](LAVEPAY.md)
- [LAVE Core source changes and build](docs/LAVE-CORE.md)
- [Network profiles and identity](payments/docs/NETWORK-SPEC.md)
- [Four-node payment laboratory and migration](payments/docs/LAB.md)
- [Wallet approval, encrypted backups and recovery](payments/docs/WALLET.md)
- [Launch and retire a masternode from your wallet](payments/docs/WALLET-MASTERNODES.md)
- [Payment-network seed masternodes and quorum evidence](payments/docs/PAYMENT-MASTERNODES.md)
- [Security boundaries](payments/docs/SECURITY.md)
- [Separate LAVE-Q masternode laboratory](payments/docs/MASTERNODES.md)
- [LAVEPAY 0.6 validation results](payments/docs/VALIDATION-V06.md)
- [LAVEPAY 0.5 validation results](payments/docs/VALIDATION-V05.md)
- [Delivery roadmap](payments/docs/ROADMAP.md)

Payment-chain capabilities are derived from its own observed quorum evidence.
Invoice settlement still requires a block confirmation. The separate LAVE-Q
laboratory exercises quorum behavior on another chain; its results do not confer
finality on LAVE payments. All local nodes still share
one host. Upstream source and license notices are retained below.

---

Dash Core staging tree
===========================

| `master`                                                                                                                                            | `develop`                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Build Status](https://github.com/dashpay/dash/actions/workflows/build.yml/badge.svg?branch=master)](https://github.com/dashpay/dash/tree/master) | [![Build Status](https://github.com/dashpay/dash/actions/workflows/build.yml/badge.svg?branch=develop)](https://github.com/dashpay/dash/tree/develop) |

https://www.dash.org

For an immediately usable, binary version of the Dash Core software, see
https://www.dash.org/downloads/.

Dash Core connects to the Dash peer-to-peer network to download and fully
validate blocks and transactions. It also includes a wallet and graphical user
interface, which can be optionally built.

Further information about Dash Core is available in the [doc folder](/doc).

What is Dash?
-------------

Dash is a digital currency that enables instant, private payments to anyone,
anywhere in the world. Dash uses peer-to-peer technology to operate with
no central authority: managing transactions and issuing money are carried out
collectively by the network. Dash Core is the name of the open
source software which enables the use of this currency.

For more information read the original Dash whitepaper.

License
-------

Dash Core is released under the terms of the MIT license. See [COPYING](COPYING) for more
information or see https://opensource.org/licenses/MIT.

Development Process
-------------------

The `master` branch is meant to be stable. Development is normally done in separate branches.
[Tags](https://github.com/dashpay/dash/tags) are created to indicate new official,
stable release versions of Dash Core.

The `develop` branch is regularly built (see doc/build-*.md for instructions) and tested, but is not guaranteed to be
completely stable.

The contribution workflow is described in [CONTRIBUTING.md](CONTRIBUTING.md)
and useful hints for developers can be found in [doc/developer-notes.md](doc/developer-notes.md).

Build / Compile from Source
---------------------------

The `./configure`, `make`, and `cmake` steps, as well as build dependencies, are in [./doc/](/doc) as well:

- **Linux**: [./doc/build-unix.md](/doc/build-unix.md) \
  Ubuntu, Debian, Fedora, Arch, and others
- **macOS**: [./doc/build-osx.md](/doc/build-osx.md)
- **Windows**: [./doc/build-windows.md](/doc/build-windows.md)
- **OpenBSD**: [./doc/build-openbsd.md](/doc/build-openbsd.md)
- **FreeBSD**: [./doc/build-freebsd.md](/doc/build-freebsd.md)
- **NetBSD**: [./doc/build-netbsd.md](/doc/build-netbsd.md)

Testing
-------

Testing and code review is the bottleneck for development; we get more pull
requests than we can review and test on short notice. Please be patient and help out by testing
other people's pull requests, and remember this is a security-critical project where any mistake might cost people
lots of money.

### Automated Testing

Developers are strongly encouraged to write [unit tests](src/test/README.md) for new code, and to
submit new unit tests for old code. Unit tests can be compiled and run
(assuming they weren't disabled in configure) with: `make check`. Further details on running
and extending unit tests can be found in [/src/test/README.md](/src/test/README.md).

There are also [regression and integration tests](/test), written
in Python.
These tests can be run (if the [test dependencies](/test) are installed) with: `test/functional/test_runner.py`

The CI (Continuous Integration) systems make sure that every pull request is built for Windows, Linux, and macOS,
and that unit/sanity tests are run automatically.

### Manual Quality Assurance (QA) Testing

Changes should be tested by somebody other than the developer who wrote the
code. This is especially important for large or high-risk changes. It is useful
to add a test plan to the pull request description if testing the changes is
not straightforward.

Translations
------------

Changes to translations as well as new translations can be submitted to
[Dash Core's Transifex page](https://explore.transifex.com/dash/dash/).

Translations are periodically pulled from Transifex and merged into the git repository. See the
[translation process](doc/translation_process.md) for details on how this works.

**Important**: We do not accept translation changes as GitHub pull requests because the next
pull from Transifex would automatically overwrite them again.
