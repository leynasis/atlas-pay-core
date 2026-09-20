import { createWalletBackup } from "./service.mjs";
import { SignerError } from "../signer/policy.mjs";

// The caller MUST finish its existing Host + exact Origin + session CSRF checks
// before invoking this helper. It accepts no request/body logging or RPC paths.
export async function exportBackupResponse({
  service,
  journalPath,
  body,
  response,
}) {
  if (
    !body ||
    Object.keys(body).some((key) => key !== "password") ||
    typeof body.password !== "string"
  )
    throw new SignerError(
      "INVALID_INPUT",
      "Backup export requires only a password.",
    );
  const password = body.password;
  delete body.password;
  const result = await createWalletBackup({
    signer: service.signer,
    store: service.store,
    journalPath,
    password,
  });
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "Content-Length": result.bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(result.bytes);
}
