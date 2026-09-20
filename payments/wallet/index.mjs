import { fileURLToPath } from "node:url";
import { openWallet } from "./runtime.mjs";
import { createWalletServer } from "./http.mjs";
const role = process.argv[2];
if (!["customer", "merchant"].includes(role))
  throw new Error("Usage: node wallet/index.mjs customer|merchant");
const port = role === "customer" ? 4174 : 4175;
const { service, store } = await openWallet(role);
const server = createWalletServer({
  service,
  role,
  staticDir: fileURLToPath(new URL("../web/dist", import.meta.url)),
});
server.listen(port, "127.0.0.1", () =>
  console.log(`LAVEPAY ${role} wallet: http://127.0.0.1:${port}`),
);
server.on("error", (error) => {
  console.error(`Wallet listener failed: ${error.code || "ERROR"}`);
  store.close();
  process.exitCode = 1;
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
