import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PAYMENTS_DIR = fileURLToPath(new URL("../", import.meta.url));
export const RUNTIME_DIR = join(PAYMENTS_DIR, ".runtime");
export const DATA_DIR = join(RUNTIME_DIR, "chain");
export const COOKIE_PATH = join(DATA_DIR, "regtest", ".cookie");
export const CONF_PATH = join(RUNTIME_DIR, "dash.conf");
export const VERSION = "23.1.8";
export const RELEASE_URL = `https://github.com/dashpay/dash/releases/download/v${VERSION}`;
export const BIN_DIR = join(RUNTIME_DIR, `dashcore-${VERSION}`, "bin");
export const DAEMON_PATH = join(BIN_DIR, "dashd");
export const RPC_PORT = 19898;
export const P2P_PORT = 19899;
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
export const WALLETS = Object.freeze({ merchant: "merchant", payer: "payer" });

// Taken from the official v23.1.8 SHA256SUMS.asc and cross-checked with
// GitHub release asset digests. Installing never discovers a moving "latest".
export const RELEASES = Object.freeze({
  "darwin-arm64": [
    "arm64-apple-darwin",
    "a3db11790722d3ca08a5205aa985cb7a8a12f649e6bed7c46d6de480b25c14b5",
  ],
  "darwin-x64": [
    "x86_64-apple-darwin",
    "e95337f0a12deae9b949ca791ba5704ad25c28f13d361ab9cdab4784226cd835",
  ],
  "linux-arm64": [
    "aarch64-linux-gnu",
    "b96fef477ea01f5c47cc3d3f7de3fdd0bc8cc86f64660f720e8206d889604523",
  ],
  "linux-x64": [
    "x86_64-linux-gnu",
    "e664cad0fe860afa3d005be0db1eb06da598f2f83421083afae77191e3115825",
  ],
});
