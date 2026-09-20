import { open, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { SignerError } from "../signer/policy.mjs";
import { MAX_BACKUP_BYTES } from "./crypto.mjs";
import { createWalletBackup, restoreWalletBackup } from "./service.mjs";

const HELP = `Usage:
  node backup/cli.mjs export <customer|merchant> <new-file.lavebackup>
  node backup/cli.mjs restore <customer|merchant> <file.lavebackup> <new-directory>

Requires an interactive terminal. Passwords are hidden and never accepted as
arguments, environment variables or piped input. Restore creates fresh files
only; it does not replace or load a running wallet. Restored journals block new
signatures and permit only retries of transactions whose signed bytes were saved.
The selected profile must be LAVE; Atlas wallets cannot be relabeled or restored.`;

export function readPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SignerError(
      "TTY_REQUIRED",
      "Backup passwords require an interactive terminal.",
    );
  return new Promise((accept, reject) => {
    const input = process.stdin,
      decoder = new StringDecoder("utf8");
    const wasRaw = input.isRaw,
      wasPaused = input.isPaused();
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      input.setRawMode(Boolean(wasRaw));
      if (wasPaused) input.pause();
      process.stdout.write("\n");
    };
    const onError = () => {
      cleanup();
      reject(
        new SignerError(
          "PASSWORD_INPUT_FAILED",
          "Password entry was interrupted.",
        ),
      );
    };
    const onData = (bytes) => {
      for (const character of decoder.write(bytes)) {
        if (character === "\u0003" || character === "\u0004") {
          onError();
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          accept(value);
          return;
        }
        if (character === "\u007f" || character === "\b")
          value = Array.from(value).slice(0, -1).join("");
        else if (character >= " " && character !== "\u001b") value += character;
        if (Buffer.byteLength(value) > 1024) {
          cleanup();
          reject(
            new SignerError(
              "INVALID_BACKUP_PASSWORD",
              "Backup password exceeds the supported length.",
            ),
          );
          return;
        }
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.on("data", onData);
    input.on("error", onError);
    input.resume();
  });
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === "--help") {
    console.log(HELP);
    return;
  }
  const [command, role, path, directory] = args;
  if (
    !["customer", "merchant"].includes(role) ||
    (command === "export"
      ? args.length !== 3
      : command === "restore"
        ? args.length !== 4
        : true) ||
    args.some((arg) => arg.startsWith("--"))
  )
    throw new Error(HELP);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SignerError(
      "TTY_REQUIRED",
      "Backup passwords require an interactive terminal.",
    );
  const { NETWORK_IDENTITY, SIGNER_DIR } = await import("../lab/config.mjs");
  if (NETWORK_IDENTITY.currency !== "LAVE")
    throw new SignerError(
      "BACKUP_PROFILE_UNSUPPORTED",
      "Only the pinned LAVE descriptor profile is supported.",
    );
  const password = await readPassword("Backup password (hidden): ");
  if (command === "export") {
    const confirmation = await readPassword("Repeat password (hidden): ");
    if (password !== confirmation)
      throw new SignerError(
        "PASSWORD_MISMATCH",
        "Backup passwords do not match.",
      );
    const { openRoleSigner } = await import("../signer/runtime.mjs");
    const { signer, store } = await openRoleSigner(role);
    try {
      const result = await createWalletBackup({
        signer,
        store,
        journalPath: join(SIGNER_DIR, `${role}.sqlite`),
        password,
      });
      const file = await open(resolve(path), "wx", 0o600);
      try {
        await file.writeFile(result.bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      console.log(
        JSON.stringify(
          {
            path: resolve(path),
            role,
            encrypted: true,
            bytes: result.bytes.length,
          },
          null,
          2,
        ),
      );
    } finally {
      store.close();
    }
  } else {
    if ((await stat(resolve(path))).size > MAX_BACKUP_BYTES)
      throw new SignerError(
        "BACKUP_TOO_LARGE",
        "Backup exceeds the supported file size.",
      );
    const result = await restoreWalletBackup({
      bytes: await readFile(resolve(path)),
      password,
      directory: resolve(directory),
      role,
      network: NETWORK_IDENTITY,
    });
    console.log(JSON.stringify(result, null, 2));
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
