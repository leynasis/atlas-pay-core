# LAVEPAY

A Dash Core fork with a working local payment workspace: merchant invoices,
QR checkout, real test transactions, durable payment tracking and explicit refunds.
Version 0.3 runs invoices on a three-node named devnet, with separate browser
wallets for customer payment and merchant-approved refunds.

**Current stage: local named-devnet payment prototype.** No live funds, public mainnet,
fiat conversion or worldwide merchant service are launched by this repository.
**LAVE** is the selected name of the planned native currency; **LAVEPAY** is the
payment system. The existing laboratory still transacts in valueless test DASH
on `atlas-local-v1`; the brand change does not issue LAVE or change consensus.

```sh
cd payments
npm ci
npm run demo
```

Open **http://127.0.0.1:4173**. Requires Node.js 22.13+; the setup downloads a
checksum-verified official Dash Core 23.1.8 runtime into an isolated directory.

- [Setup and payment walkthrough](payments/README.md)
- [Fork baseline and project scope](LAVEPAY.md)
- [Delivery roadmap](payments/docs/ROADMAP.md)
- [Security boundaries](payments/docs/SECURITY.md)
- [Three-node network lab](payments/docs/LAB.md)
- [Customer signing prototype](payments/docs/SIGNER.md)
- [Local architecture and network separation](payments/docs/ARCHITECTURE.md)

Application changes live in `payments/`. Upstream consensus is unchanged;
the original Dash source and license notices are retained below.

---

Dash Core staging tree
===========================

| `master` | `develop` |
| -------- | --------- |
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
