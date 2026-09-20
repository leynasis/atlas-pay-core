import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { SignerError, requirePolicy } from "../signer/policy.mjs";
import { exportBackupResponse } from "../backup/http.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const SESSION_MS = 6 * 60 * 60 * 1000;
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function fail(code, message, status = 400) {
  const error = new SignerError(code, message);
  error.status = status;
  throw error;
}
async function readJson(req) {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] || "")
  )
    fail("UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json.", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384)
      fail("BODY_TOO_LARGE", "Request body exceeds 16 KiB.", 413);
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("INVALID_JSON", "Invalid JSON request.");
  }
  requirePolicy(
    body && typeof body === "object" && !Array.isArray(body),
    "INVALID_INPUT",
    "A JSON object is required.",
  );
  return body;
}
function equalToken(actual, expected) {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
async function staticResponse(req, res, dir, path) {
  if (!dir) fail("NOT_FOUND", "Not found.", 404);
  let root;
  try {
    root = await realpath(dir);
  } catch {
    fail("FRONTEND_NOT_BUILT", "Build the frontend first.", 503);
  }
  let file = resolve(root, `.${path}`);
  if (!file.startsWith(`${root}${sep}`) && file !== root)
    fail("INVALID_PATH", "Invalid path.");
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
  } catch {
    if (!extname(path)) file = resolve(root, "index.html");
    else fail("NOT_FOUND", "Not found.", 404);
  }
  let canonical;
  try {
    canonical = await realpath(file);
  } catch {
    fail("NOT_FOUND", "Not found.", 404);
  }
  if (!canonical.startsWith(`${root}${sep}`))
    fail("INVALID_PATH", "Invalid path.");
  const bytes = await readFile(canonical);
  res.writeHead(200, {
    "Content-Type": MIME[extname(canonical)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Content-Length": bytes.length,
  });
  res.end(req.method === "HEAD" ? undefined : bytes);
}
export function createWalletServer({
  service,
  role,
  staticDir,
  journalPath,
  now = () => Date.now(),
}) {
  requirePolicy(
    ["customer", "merchant"].includes(role),
    "WRONG_ROLE",
    "Unknown wallet role.",
  );
  const sessions = new Map();
  const cookieName = `${service.signer.identity.currency === "LAVE" ? "lave" : "atlas"}_${role}_wallet_session`;
  function session(req, res, create = false) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const existing = sessions.get(token);
    if (existing && existing.expiresAt > now()) return existing;
    if (!create)
      fail(
        "SESSION_REQUIRED",
        "Reload the wallet to establish a session.",
        403,
      );
    for (const [key, value] of sessions)
      if (value.expiresAt <= now()) sessions.delete(key);
    if (sessions.size >= 1000)
      fail("SESSION_LIMIT", "Too many wallet sessions.", 503);
    const id = randomBytes(32).toString("hex");
    const value = {
      csrfToken: randomBytes(32).toString("hex"),
      expiresAt: now() + SESSION_MS,
    };
    sessions.set(id, value);
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    );
    return value;
  }
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const host = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== host)
        fail(
          "INVALID_HOST",
          "Only this fixed loopback wallet host is allowed.",
          403,
        );
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(
          "INVALID_ORIGIN",
          "Cross-site wallet requests are not allowed.",
          403,
        );
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers.origin !== `http://${host}`)
          fail("INVALID_ORIGIN", "The exact wallet origin is required.", 403);
        const current = session(req, res);
        if (!equalToken(req.headers["x-csrf-token"], current.csrfToken))
          fail("INVALID_CSRF", "Wallet session token does not match.", 403);
      }
      let path;
      try {
        path = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        fail("INVALID_PATH", "Invalid path.");
      }
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").some((part) => part === ".." || part === ".")
      )
        fail("INVALID_PATH", "Invalid path.");
      if (req.method === "GET" && path === "/api/wallet/status") {
        const current = session(req, res, true);
        try {
          return json(res, 200, {
            ...(await service.status()),
            csrfToken: current.csrfToken,
          });
        } catch {
          return json(res, 200, {
            role,
            network: service.signer.identity,
            currency: service.signer.identity.currency || "DASH",
            profile:
              service.signer.identity.currency === "LAVE" ? "lave" : "atlas",
            devnetName: service.signer.identity.devnetName,
            balance: null,
            pendingBalance: null,
            receiveAddress: null,
            chainAvailable: false,
            blockHeight: null,
            csrfToken: current.csrfToken,
            error: {
              code: "CHAIN_UNAVAILABLE",
              message: "The pinned wallet node is unavailable.",
            },
          });
        }
      }
      if (req.method === "POST" && path === "/api/wallet/backup") {
        if (!journalPath)
          fail("BACKUP_UNAVAILABLE", "Backup export is unavailable.", 503);
        return await exportBackupResponse({
          service,
          journalPath,
          body: await readJson(req),
          response: res,
        });
      }
      if (
        req.method === "POST" &&
        [
          "/api/wallet/prepare",
          "/api/wallet/approve",
          "/api/wallet/cancel",
        ].includes(path)
      ) {
        const action = path.split("/").at(-1);
        return json(res, 200, await service[action](await readJson(req)));
      }
      const match = /^\/api\/wallet\/requests\/([0-9a-f-]{36})$/.exec(path);
      if (req.method === "GET" && match)
        return json(res, 200, await service.getRequest(match[1]));
      if (path.startsWith("/api/")) fail("NOT_FOUND", "Not found.", 404);
      if (req.method === "GET" || req.method === "HEAD")
        return await staticResponse(req, res, staticDir, path);
      fail("NOT_FOUND", "Not found.", 404);
    } catch (error) {
      const exposed = error instanceof SignerError;
      json(
        res,
        error.status ||
          (exposed ? (error.code === "NOT_FOUND" ? 404 : 409) : 503),
        {
          error: {
            code: exposed ? error.code : "WALLET_UNAVAILABLE",
            message: exposed
              ? error.message
              : "The wallet operation could not complete. Refresh the saved request before retrying.",
          },
        },
      );
    }
  });
}
