import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openCustomerSigner } from "./runtime.mjs";
import { SignerError } from "./policy.mjs";

const HELP = `Usage:
  node signer/cli.mjs prepare <request.json>
  node signer/cli.mjs approve <request-id>
  node signer/cli.mjs status <request-id>
  node signer/cli.mjs cancel <request-id>

approve requires an interactive terminal and fingerprint-bound customer approval.
There is no --yes option. cancel only releases inputs of unsigned prepared drafts.
This tool operates only on the pinned named devnet and the customer node/wallet.`;

export async function terminalApproval(review) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SignerError(
      "TTY_REQUIRED",
      "Customer approval requires an interactive terminal. Piped approval and --yes are not supported.",
    );
  console.log(
    "\nReview the actual transaction before approving. Merchant labels are unverified.",
  );
  console.log(JSON.stringify(review, null, 2));
  const expected = `APPROVE ${review.fingerprint}`;
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (
      (await readline.question(`\nType exactly ${expected}\n> `)) === expected
    );
  } finally {
    readline.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    return;
  }
  const [command, argument] = args;
  if (
    args.length !== 2 ||
    !["prepare", "approve", "status", "cancel"].includes(command) ||
    argument.startsWith("--")
  )
    throw new Error(HELP);
  if (command === "approve" && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new SignerError(
      "TTY_REQUIRED",
      "Customer approval requires an interactive terminal.",
    );
  const { signer, store } = await openCustomerSigner();
  try {
    let result;
    if (command === "prepare") {
      const path = resolve(argument);
      if ((await stat(path)).size > 16_384)
        throw new Error("Payment request is too large.");
      result = await signer.prepare(JSON.parse(await readFile(path, "utf8")));
    } else if (command === "approve")
      result = await signer.approve(argument, terminalApproval);
    else if (command === "cancel") result = await signer.cancel(argument);
    else result = await signer.status(argument);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(`${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
