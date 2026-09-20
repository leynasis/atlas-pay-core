import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAB_DIR, MERCHANT_DB_PATH, NODES } from "../lab/config.mjs";

export const paymentsRoot = fileURLToPath(new URL("../", import.meta.url));
const quote = (path) => JSON.stringify(resolve(path));

// Development confinement for the HTTP cashier on macOS. Start from deny-all;
// never grant a directory containing private Core wallets or admin cookies.
// The host owner and unsandboxed Core/wallet services remain trusted.
export function cashierProfile({
  root = paymentsRoot,
  data = dirname(MERCHANT_DB_PATH),
  extraRead = [],
} = {}) {
  const node = realpathSync(process.execPath);
  const sources = [
    "merchant",
    "server",
    "signer",
    "network",
    "lab",
    "masternodes",
    "isolation",
    "web/dist",
    "node_modules",
  ].map((p) => join(root, p));
  const readable = [
    ...sources,
    data,
    join(LAB_DIR, "dashboard"),
    join(LAB_DIR, "merchant-api"),
    join(LAB_DIR, "miner-api"),
    join(root, ".runtime/masternodes/public"),
    ...extraRead,
  ];
  return `(version 1)
(deny default)
(allow process-exec (literal ${quote(node)}))
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read* file-map-executable
  (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share")
  (subpath "/opt/homebrew") (literal "/dev/urandom") (literal "/dev/random")
  (literal "/private/etc/localtime") (subpath "/private/var/db/timezone")
  (literal ${quote(node)})
  (literal ${quote(root)})
  (literal ${quote(join(root, "package.json"))})
  ${readable.map((p) => `(subpath ${quote(p)})`).join("\n  ")}
)
(allow file-read* file-write-data (literal "/dev/null") (subpath "/dev/fd"))
(allow file-write* (subpath ${quote(data)}))
(allow network-inbound network-bind (local ip "localhost:4173"))
(allow network-outbound ${Object.values(NODES)
    .map((n) => `(remote ip "localhost:${n.rpcPort}")`)
    .join(" ")})
`;
}

export function cashierEnvironment(mode) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      LANG: process.env.LANG,
      TZ: process.env.TZ,
      LAVEPAY_NETWORK: process.env.LAVEPAY_NETWORK,
      LAVEPAY_DEV_ORIGIN:
        process.env.LAVEPAY_DEV_ORIGIN || process.env.ATLAS_DEV_ORIGIN,
      LAVEPAY_CASHIER_CONFINEMENT: mode,
    }).filter(([, value]) => value !== undefined),
  );
}

export function cashierCommand(script = "merchant/index.mjs", args = []) {
  if (process.env.LAVEPAY_ISOLATION === "off")
    return {
      command: process.execPath,
      args: [script, ...args],
      mode: "disabled",
    };
  if (
    process.env.LAVEPAY_ISOLATION &&
    process.env.LAVEPAY_ISOLATION !== "macos"
  )
    throw new Error("LAVEPAY_ISOLATION must be macos or off.");
  if (process.platform !== "darwin")
    throw new Error(
      "Cashier confinement currently requires macOS. For an explicitly unconfined local demo only, set LAVEPAY_ISOLATION=off.",
    );
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", cashierProfile(), process.execPath, script, ...args],
    mode: "macos-seatbelt",
  };
}
