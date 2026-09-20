import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MERCHANT_DB_PATH } from "../lab/config.mjs";
import { MerchantStore } from "./store.mjs";
import { MerchantService } from "./service.mjs";
import { merchantContext } from "./runtime.mjs";
import { createMerchantHttpServer } from "./http.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function createMerchantApplication({
  dbPath = MERCHANT_DB_PATH,
  staticDir = resolve(root, "web/dist"),
  developmentOrigin,
  qrEncoder,
  now,
  ...overrides
} = {}) {
  const context = { ...merchantContext(), ...overrides };
  const store = new MerchantStore(dbPath);
  const service = new MerchantService({ ...context, store, now });
  const server = createMerchantHttpServer({
    service,
    staticDir,
    developmentOrigin,
    qrEncoder,
    labStatus: context.labStatus,
  });
  return {
    server,
    service,
    store,
    async close() {
      if (server.listening)
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      await service.queue;
      store.close();
    },
  };
}

export async function startMerchant() {
  const app = createMerchantApplication({
    developmentOrigin:
      process.env.LAVEPAY_DEV_ORIGIN || process.env.ATLAS_DEV_ORIGIN,
  });
  const status = await app.service.status();
  await new Promise((done, reject) => {
    app.server.once("error", reject);
    app.server.listen(4173, "127.0.0.1", done);
  });
  console.log(
    `LAVEPAY merchant: http://127.0.0.1:4173 (${status.connected ? `${status.network}, block ${status.blockHeight}` : status.error})`,
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
  startMerchant().catch((error) => {
    console.error(`Merchant API could not start: ${error.message}`);
    process.exitCode = 1;
  });
