import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createWalletServer } from "../wallet/http.mjs";

test("masternode mutations require the wallet session and exact origin; RPC proxy paths are absent", async () => {
  const calls = [];
  const service = {
    signer: { identity: { currency: "LAVE" } },
    async status() {
      return { chainAvailable: true };
    },
  };
  const staking = {
    async status() {
      return { supported: true, nodes: [] };
    },
    async prepare(body) {
      calls.push(["prepare", body]);
      return { review: { id: "saved" } };
    },
    async stop(body) {
      calls.push(["stop", body]);
      return { nodes: [{ collateralLocked: true }] };
    },
    async retirePrepare(body) {
      calls.push(["retirePrepare", body]);
      return { review: { kind: "retire" } };
    },
  };
  const server = createWalletServer({ service, staking, role: "customer" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(origin + "/api/wallet/status");
    const { csrfToken } = await status.json();
    const cookie = status.headers.get("set-cookie").split(";")[0];
    const post = (action, headers = {}, body = {}) =>
      fetch(`${origin}/api/wallet/masternodes/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const authorized = {
      Origin: origin,
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    };
    for (const headers of [
      {},
      { Origin: origin },
      { ...authorized, Origin: "http://127.0.0.1:4173" },
      { ...authorized, "X-CSRF-Token": "0".repeat(64) },
    ])
      assert.equal((await post("prepare", headers)).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(
      (await post("prepare", authorized, { name: "Home node" })).status,
      200,
    );
    assert.equal(
      (await post("stop", authorized, { nodeId: "customer-local" })).status,
      200,
    );
    assert.equal(
      (await post("retire-prepare", authorized, { nodeId: "customer-local" }))
        .status,
      200,
    );
    for (const action of ["rpc", "unlock", "__proto__", "constructor"])
      assert.equal((await post(action, authorized)).status, 404);
    assert.deepEqual(
      calls.map(([method]) => method),
      ["prepare", "stop", "retirePrepare"],
    );
    assert.equal(
      (await fetch(origin + "/api/wallet/masternodes/start")).status,
      404,
    );
    const publicState = await fetch(origin + "/api/wallet/masternodes");
    assert.equal(publicState.headers.get("cache-control"), "no-store");
    assert.deepEqual(await publicState.json(), { supported: true, nodes: [] });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("parallel wallet and masternode refreshes serialize instead of colliding with the wallet reservation gate", async () => {
  let active = 0,
    maximum = 0;
  const read = async () => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await delay(10);
      return { chainAvailable: true };
    } finally {
      active--;
    }
  };
  const server = createWalletServer({
    service: { signer: { identity: { currency: "LAVE" } }, status: read },
    staking: { status: read },
    role: "customer",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        fetch(`${origin}/api/wallet/${i % 2 ? "status" : "masternodes"}`),
      ),
    );
    assert.ok(replies.every((response) => response.status === 200));
    for (const response of replies)
      assert.equal((await response.json()).chainAvailable, true);
    assert.equal(maximum, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
