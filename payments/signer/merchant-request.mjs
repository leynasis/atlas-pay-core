import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createPaymentRequest } from "./service.mjs";
import { labContext } from "./runtime.mjs";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      amount: { type: "string" },
      description: { type: "string" },
      merchant: { type: "string", default: "Atlas Studio" },
      out: { type: "string" },
      minutes: { type: "string", default: "60" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'Usage: node signer/merchant-request.mjs --amount 0.25 --description "Order #1042" --merchant "Atlas Studio" --out request.json [--minutes 60]\nCreates a named-devnet merchant payment request. No customer wallet is accessed.',
    );
    return;
  }
  if (!values.amount || !values.description || !values.out)
    throw new Error("--amount, --description and --out are required.");
  const context = await labContext("merchant");
  const request = await createPaymentRequest({
    ...context,
    amount: values.amount,
    merchantName: values.merchant,
    description: values.description,
    expiresInMinutes: Number(values.minutes),
  });
  const path = resolve(values.out);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(request, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify(
      {
        requestId: request.id,
        path,
        amount: request.amount,
        address: request.address,
        network: request.network,
        requestHash: request.requestHash,
      },
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(`${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
