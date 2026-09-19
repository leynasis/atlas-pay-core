import { readFile } from "node:fs/promises";
import { RpcError } from "./errors.mjs";

export function parseRpcJson(input) {
  let result = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] === '"') {
      const start = i++;
      while (i < input.length) {
        if (input[i] === "\\") {
          i += 2;
          continue;
        }
        if (input[i++] === '"') break;
      }
      result += input.slice(start, i);
    } else if (input[i] === "-" || /\d/.test(input[i])) {
      const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!match) throw new Error("Invalid RPC JSON");
      const token = match[0];
      result += /[.eE]/.test(token) ? JSON.stringify(token) : token;
      i += token.length;
    } else {
      result += input[i++];
    }
  }
  return JSON.parse(result);
}

export class DashRpc {
  constructor({
    cookiePath,
    url = "http://127.0.0.1:19898",
    timeoutMs = 15_000,
    fetchImpl = fetch,
  }) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "19898"
    )
      throw new Error(
        "Only the isolated loopback regtest RPC endpoint is supported.",
      );
    this.cookiePath = cookiePath;
    this.url = parsed.origin;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async call(method, params = [], wallet) {
    let response;
    try {
      const cookie = (await readFile(this.cookiePath, "utf8")).trim();
      response = await this.fetch(
        `${this.url}${wallet ? `/wallet/${encodeURIComponent(wallet)}` : "/"}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            Authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "1.0",
            id: "atlas-pay",
            method,
            params,
          }),
        },
      );
      const body = parseRpcJson(await response.text());
      if (body.error)
        throw new RpcError("Dash RPC rejected the request.", {
          code: body.error.code,
          definitive: true,
        });
      if (!response.ok || !Object.hasOwn(body, "result"))
        throw new RpcError("Invalid Dash RPC response.");
      return body.result;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError("Cannot reach the local Dash RPC.");
    }
  }
}
