import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { InvoiceStore } from "./store.mjs";
import { DashRpc } from "./rpc.mjs";
import { PaymentService } from "./service.mjs";
import { createHttpServer } from "./http.mjs";

const paymentsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createApplication({
  rpc,
  dbPath = resolve(paymentsRoot, ".runtime/invoices.sqlite"),
  staticDir = resolve(paymentsRoot, "web/dist"),
  now,
  qrEncoder,
  developmentOrigin,
  labStatus = async () => {
    const { getLabStatus } = await import("../lab/status.mjs");
    return getLabStatus();
  },
} = {}) {
  const store = new InvoiceStore(dbPath);
  const service = new PaymentService({
    store,
    rpc:
      rpc ||
      new DashRpc({
        cookiePath: resolve(paymentsRoot, ".runtime/chain/regtest/.cookie"),
      }),
    now,
  });
  const server = createHttpServer({
    service,
    staticDir,
    qrEncoder,
    developmentOrigin,
    labStatus,
  });
  return {
    server,
    service,
    store,
    async close() {
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await service.queue;
      store.close();
    },
  };
}

export async function start() {
  const app = createApplication({
    staticDir: resolve(paymentsRoot, ".runtime/legacy-api-only"),
    developmentOrigin: process.env.ATLAS_DEV_ORIGIN,
  });
  // Fail closed before serving monetary actions. A disconnected node still gets a useful
  // read-only status screen; every future mutation re-verifies the chain and isolation.
  const status = await app.service.status();
  await new Promise((done, reject) => {
    app.server.once("error", reject);
    app.server.listen(4180, "127.0.0.1", done);
  });
  console.log(
    `Legacy regtest API: http://127.0.0.1:4180 (${status.connected ? `regtest block ${status.blockHeight}` : status.error})`,
  );
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return app;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  start().catch((error) => {
    console.error(`Atlas Pay could not start: ${error.message}`);
    process.exitCode = 1;
  });
