# Legacy isolated Dash regtest

The v0.3 default payment UI uses [the three-node devnet](LAB.md). This document covers only the optional older regtest API on port 4180.

This legacy environment runs the **official, prebuilt Dash Core 23.1.8 release**, not a locally compiled or independently audited fork client. The repository contains the upstream source for further development. These scripts leave consensus unchanged and operate exclusively on an isolated regtest chain. Regtest coins have no monetary value.

## Requirements and commands

Node.js 22 or newer, `tar`, and macOS or Linux on ARM64/x64. The first start downloads the pinned official binary. Run from `payments/`:

```sh
node network/install.mjs # optional: start also installs when needed
node network/start.mjs
node network/status.mjs
node network/stop.mjs
```

The installer checks the exact SHA256 of the upstream `SHA256SUMS.asc` manifest, checks the selected archive's entry against a hard-coded checksum, and hashes the downloaded archive before extraction. It preserves the signed manifest locally. **OpenPGP signatures are not independently verified by this script**; verification here means pinned SHA256 integrity against the official release metadata reviewed for this prototype.

On Apple Silicon, the verified upstream tarball's unsigned executables receive a **local ad-hoc code signature** so macOS can run them. This is not an upstream developer signature and does not disable or modify system security settings. Archive integrity is verified before this local preparation; the installation record notes the signing step.

Official release: https://github.com/dashpay/dash/releases/tag/v23.1.8

The macOS ARM64 archive SHA256 is:

```text
a3db11790722d3ca08a5205aa985cb7a8a12f649e6bed7c46d6de480b25c14b5
```

## Paths and RPC contract

All runtime files are under the gitignored `payments/.runtime/` directory. Paths resolve relative to the scripts, independent of the shell working directory.

| Item | Value |
| --- | --- |
| Datadir | `payments/.runtime/chain` |
| Regtest files | `payments/.runtime/chain/regtest` |
| Authentication cookie | `payments/.runtime/chain/regtest/.cookie` |
| Generated configuration | `payments/.runtime/dash.conf` |
| Daemon | `payments/.runtime/dashcore-23.1.8/bin/dashd` |
| RPC | `http://127.0.0.1:19898` |
| P2P bind | `127.0.0.1:19899`, networking disabled |
| Wallets | `merchant`, `payer` |

The daemon is always given an explicit datadir, configuration file and `-regtest=1`. It never reads the user's default Dash datadir. Peer discovery, DNS seeds, Tor listeners, port mapping and P2P activity are disabled. RPC binds only to IPv4 loopback and uses Dash's generated cookie; no static username/password is stored in source or browser code.

The backend can import the helper:

```js
import { rpc, assertRegtest } from '../network/rpc.mjs';
await assertRegtest();
const address = await rpc('getnewaddress', ['invoice-123'], 'merchant');
```

`rpc(method, params = [], wallet, { timeout = 15000 } = {})` reads the cookie for each request and returns the JSON-RPC result. RPC exceptions retain the numerical `.code`. The helper has no configurable remote URL. `assertRegtest()` rejects other chains, active networking and connected peers. Never log, return to a browser, or commit the authentication cookie.

## Repeatable funding

Start creates or loads both wallets. If the payer's spendable balance is below 100 test DASH, it mines 110 blocks to the payer. This produces mature coinbase funds without altering the consensus maturity rule. If the merchant's confirmed balance is below 1 test DASH, the payer transfers 2 test DASH to provide a reserve for refund fees, followed by one generated block.

An ordinary repeat start with sufficient balances creates no additional blocks and preserves all addresses and payment history. Stop requests a graceful RPC shutdown; it does not delete either wallet. The regtest chain is deliberately mined on demand. It does not produce blocks continuously.

These development wallets are unencrypted local test fixtures, protected by the runtime directory's owner-only permissions. They are unsuitable for real funds or production deployment.

## What this environment validates

Actual Dash addresses, signed transactions, wallet balances, transaction fees, mempool acceptance, generated-block confirmations and refunds can be exercised against the daemon. It is a single-node regtest with no masternode quorum: **InstantSend and ChainLocks are not active**. The payment UI must report ordinary confirmations accurately instead of claiming InstantSend settlement.

This setup provides no evidence of production throughput, economic security, independent operators, attacks across a network partition or public-network readiness. Those need a separate, distributed testnet and a reviewed bootstrap design.
