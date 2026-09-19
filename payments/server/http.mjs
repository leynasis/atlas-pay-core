import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { AppError, publicError } from "./errors.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function checkRequestOrigin(req, developmentOrigin) {
  const port = req.socket.localPort;
  const host = req.headers.host?.toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
    throw new AppError(
      "INVALID_HOST",
      "Only the local application host is allowed.",
      403,
    );
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new AppError(
        "INVALID_ORIGIN",
        "Cross-site requests are not allowed.",
        403,
      );
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${host}` &&
      req.headers.origin !== developmentOrigin
    )
      throw new AppError(
        "INVALID_ORIGIN",
        "The request origin must match this local application.",
        403,
      );
  }
}

async function readJson(req, { optional = false } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384)
      throw new AppError("BODY_TOO_LARGE", "Request body exceeds 16 KiB.", 413);
    chunks.push(chunk);
  }
  if (bytes === 0 && optional) return {};
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] || "")
  )
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use Content-Type: application/json.",
      415,
    );
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("INVALID_INPUT", "Request body must be a JSON object.");
  return body;
}

async function staticResponse(req, res, staticDir, pathname) {
  if (!staticDir) throw new AppError("NOT_FOUND", "Not found.", 404);
  let root;
  try {
    root = await realpath(staticDir);
  } catch {
    throw new AppError(
      "FRONTEND_NOT_BUILT",
      "The frontend has not been built. Run npm run build in payments.",
      503,
    );
  }
  let file = resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${sep}`) && file !== root)
    throw new AppError("INVALID_PATH", "Invalid path.", 400);
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
  } catch {
    if (!extname(pathname)) file = resolve(root, "index.html");
    else throw new AppError("NOT_FOUND", "Not found.", 404);
  }
  let canonical;
  try {
    canonical = await realpath(file);
  } catch {
    throw new AppError("NOT_FOUND", "Not found.", 404);
  }
  if (!canonical.startsWith(`${root}${sep}`))
    throw new AppError("INVALID_PATH", "Invalid path.", 400);
  const content = await readFile(canonical);
  res.writeHead(200, {
    "Content-Type": MIME[extname(canonical)] || "application/octet-stream",
    "Cache-Control":
      extname(canonical) === ".html" ? "no-cache" : "public, max-age=3600",
    "Content-Length": content.length,
  });
  res.end(req.method === "HEAD" ? undefined : content);
}

export function createHttpServer({
  service,
  staticDir,
  qrEncoder,
  developmentOrigin,
}) {
  if (developmentOrigin && developmentOrigin !== "http://127.0.0.1:5173")
    throw new Error(
      "The only supported development origin is http://127.0.0.1:5173.",
    );
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      checkRequestOrigin(req, developmentOrigin);
      const rawPath = decodeURIComponent(req.url.split("?")[0]);
      if (
        !rawPath.startsWith("/") ||
        rawPath.startsWith("//") ||
        rawPath.includes("\\") ||
        rawPath.includes("\0") ||
        rawPath.split("/").some((part) => part === ".." || part === ".")
      )
        throw new AppError("INVALID_PATH", "Invalid path.", 400);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = decodeURIComponent(url.pathname);
      const key = req.headers["idempotency-key"];
      if (req.method === "GET" && path === "/api/status")
        return json(res, 200, await service.status());
      if (req.method === "GET" && path === "/api/invoices")
        return json(res, 200, await service.listInvoices());
      if (req.method === "POST" && path === "/api/invoices")
        return json(
          res,
          201,
          await service.createInvoice(await readJson(req), key),
        );
      if (req.method === "POST" && path === "/api/dev/mine")
        return json(res, 200, await service.mine(await readJson(req)));
      const match =
        /^\/api\/invoices\/([0-9a-f-]{36})(?:\/(pay|refund|qr))?$/.exec(path);
      if (match) {
        const [, id, action] = match;
        if (req.method === "GET" && !action)
          return json(res, 200, await service.getInvoice(id));
        if (
          req.method === "POST" &&
          (action === "pay" || action === "refund")
        ) {
          const body = await readJson(req, { optional: true });
          if (Object.keys(body).length)
            throw new AppError(
              "INVALID_INPUT",
              "This endpoint does not accept destination addresses or other request fields.",
            );
          return json(
            res,
            200,
            await (action === "pay"
              ? service.payInvoice(id, key)
              : service.refundInvoice(id, key)),
          );
        }
        if (req.method === "GET" && action === "qr") {
          const { invoice } = await service.getInvoice(id);
          const encode =
            qrEncoder ||
            (async (uri) =>
              (await import("qrcode")).default.toString(uri, {
                type: "svg",
                margin: 2,
                errorCorrectionLevel: "M",
                width: 320,
              }));
          const svg = await encode(invoice.paymentUri);
          res.writeHead(200, {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(svg);
          return;
        }
      }
      if (path.startsWith("/api/"))
        throw new AppError("NOT_FOUND", "API endpoint not found.", 404);
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      await staticResponse(req, res, staticDir, path);
    } catch (error) {
      const safe =
        error instanceof URIError
          ? new AppError("INVALID_PATH", "Invalid path.", 400)
          : publicError(error);
      if (!res.headersSent)
        json(res, safe.status, {
          error: { code: safe.code, message: safe.message },
        });
      else res.end();
    }
  });
}
