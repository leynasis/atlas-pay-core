import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { checkRequestOrigin } from "../server/http.mjs";
import { AppError } from "../server/errors.mjs";
import { merchantError } from "./service.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384)
      throw new AppError("BODY_TOO_LARGE", "Request exceeds 16 KiB.", 413);
    chunks.push(chunk);
  }
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] || "")
  )
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Use application/json.", 415);
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("INVALID_JSON", "Body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_INPUT", "Body must be a JSON object.");
  return value;
}
async function serve(req, res, directory, path) {
  let root;
  try {
    root = await realpath(directory);
  } catch {
    throw new AppError(
      "FRONTEND_NOT_BUILT",
      "Build the frontend with npm run build.",
      503,
    );
  }
  let file = resolve(root, `.${path}`);
  if (!file.startsWith(`${root}${sep}`) && file !== root)
    throw new AppError("INVALID_PATH", "Invalid path.");
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
  } catch {
    if (extname(path)) throw new AppError("NOT_FOUND", "Not found.", 404);
    file = resolve(root, "index.html");
  }
  try {
    file = await realpath(file);
  } catch {
    throw new AppError("NOT_FOUND", "Not found.", 404);
  }
  if (!file.startsWith(`${root}${sep}`))
    throw new AppError("INVALID_PATH", "Invalid path.");
  const content = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] || "application/octet-stream",
    "Cache-Control":
      extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
    "Content-Length": content.length,
  });
  res.end(req.method === "HEAD" ? undefined : content);
}

export function createMerchantHttpServer({
  service,
  staticDir,
  developmentOrigin,
  labStatus,
  masternodeStatus,
  qrEncoder,
}) {
  if (developmentOrigin && developmentOrigin !== "http://127.0.0.1:5173")
    throw new Error("Unsupported development origin.");
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
        throw new AppError("INVALID_PATH", "Invalid path.");
      const path = decodeURIComponent(
        new URL(req.url, `http://${req.headers.host}`).pathname,
      );
      const key = req.headers["idempotency-key"];
      if (req.method === "GET" && path === "/api/status")
        return json(res, 200, await service.status());
      if (req.method === "GET" && path === "/api/lab/status") {
        if (!labStatus)
          throw new AppError(
            "LAB_UNAVAILABLE",
            "Network lab status is unavailable.",
            503,
          );
        return json(res, 200, await labStatus());
      }
      if (
        req.method === "GET" &&
        path === "/api/masternodes/status" &&
        masternodeStatus
      )
        return json(res, 200, await masternodeStatus());
      if (req.method === "GET" && path === "/api/invoices")
        return json(res, 200, await service.listInvoices());
      if (req.method === "POST" && path === "/api/invoices")
        return json(
          res,
          201,
          await service.createInvoice(await body(req), key),
        );
      if (req.method === "POST" && path === "/api/dev/mine")
        return json(res, 200, await service.mine(await body(req)));
      const match =
        /^\/api\/invoices\/([0-9a-f-]{36})(?:\/(request|refund-request|refund-receipt|qr))?$/.exec(
          path,
        );
      if (match) {
        const [, id, action] = match;
        if (req.method === "GET" && !action)
          return json(res, 200, await service.getInvoice(id));
        if (req.method === "GET" && action === "request")
          return json(res, 200, await service.paymentRequest(id));
        if (req.method === "GET" && action === "refund-request")
          return json(res, 200, await service.refundRequest(id));
        if (req.method === "POST" && action === "refund-request")
          return json(
            res,
            201,
            await service.createRefundRequest(id, await body(req), key),
          );
        if (req.method === "POST" && action === "refund-receipt")
          return json(
            res,
            200,
            await service.registerRefundReceipt(id, await body(req), key),
          );
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
          const svg = await encode(invoice.checkoutUrl);
          res.writeHead(200, {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(svg);
          return;
        }
      }
      if (path.startsWith("/api/"))
        throw new AppError(
          "NOT_FOUND",
          "API endpoint not found. Signing belongs to the separate customer and merchant wallets.",
          404,
        );
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      await serve(req, res, staticDir, path);
    } catch (error) {
      const safe =
        error instanceof URIError
          ? new AppError("INVALID_PATH", "Invalid path.")
          : merchantError(error);
      if (!res.headersSent)
        json(res, safe.status, {
          error: { code: safe.code, message: safe.message },
        });
      else res.end();
    }
  });
}
