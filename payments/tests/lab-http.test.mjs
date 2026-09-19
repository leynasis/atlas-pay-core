import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer } from "../server/http.mjs";

async function endpoint(t, labStatus) {
  const server = createHttpServer({ service: {}, labStatus });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("Lab monitoring is read-only and independent of invoice wallet operations", async (t) => {
  let calls = 0;
  const snapshot = {
    name: "atlas-local-v1",
    onlineNodes: 0,
    synchronized: false,
    nodes: [],
  };
  const base = await endpoint(t, async () => {
    calls++;
    return snapshot;
  });
  const response = await fetch(`${base}/api/lab/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), snapshot);
  assert.equal(calls, 1);
  for (const path of ["/api/lab/status", "/api/lab/mine", "/api/lab/sign"]) {
    const denied = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: "{}",
    });
    assert.equal(denied.status, 404);
  }
  assert.equal(calls, 1);
});

test("Lab monitor errors never disclose RPC credentials or runtime internals", async (t) => {
  const base = await endpoint(t, async () => {
    throw new Error("private-cookie-placeholder runtime/path RPC detail");
  });
  const response = await fetch(`${base}/api/lab/status`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
    },
  });
});
