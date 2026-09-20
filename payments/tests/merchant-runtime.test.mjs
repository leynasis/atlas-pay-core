import test from "node:test";
import assert from "node:assert/strict";
import { mineDevelopment } from "../merchant/runtime.mjs";
import {
  DEVNET_GENESIS_HASH,
  EXPECTED_CHAIN,
  GENESIS_HASH,
  MINER_API_METHODS,
} from "../lab/config.mjs";

const TXID = "7".repeat(64);
const MISSING = () => Object.assign(new Error("Not found"), { code: -5 });

function fixture({
  profile = "lave",
  entry,
  autoConfirm = true,
  confirmed = false,
  synchronized = true,
} = {}) {
  const state = {
    time: 1_800_000_000_000,
    height: 123,
    confirmed,
    sleeps: 0,
    entryReads: 0,
    calls: [],
    minedAt: [],
  };
  const options = {
    profile,
    waitMs: 500,
    now: () => state.time,
    sleep: async (ms) => {
      state.time += ms;
      state.sleeps += 1;
    },
    minerRpc: async (method, params = []) => {
      assert.ok(MINER_API_METHODS.includes(method), `Limited RPC: ${method}`);
      state.calls.push({ method, params });
      switch (method) {
        case "getblockchaininfo":
          return { chain: EXPECTED_CHAIN, blocks: state.height };
        case "getnetworkinfo":
          return { networkactive: true };
        case "getpeerinfo":
          return [];
        case "getblockhash":
          return params[0] === 0 ? GENESIS_HASH : DEVNET_GENESIS_HASH;
        case "getmempoolentry":
          state.entryReads += 1;
          if (entry) return entry(state);
          return { instantlock: "true", time: state.time / 1000 };
        case "getnewaddress":
          return "test-mining-address";
        case "generatetoaddress":
          state.minedAt.push(state.time);
          state.height += params[0];
          if (autoConfirm) state.confirmed = true;
          return ["block"];
        default:
          throw new Error(`Unexpected RPC: ${method}`);
      }
    },
    merchantRpc: async (method, params) => {
      assert.equal(method, "gettransaction");
      assert.deepEqual(params, [TXID, profile === "lave"]);
      return { confirmations: state.confirmed ? 1 : 0 };
    },
    labStatus: async () => ({ synchronized, commonHeight: state.height }),
  };
  return {
    state,
    options,
    mine: (args = { blocks: 1, pendingTxids: [TXID] }) =>
      mineDevelopment(args, options),
  };
}

test("LAVE waits for the miner's actual InstantSend lock before mining a fresh payment", async () => {
  const { mine, state } = fixture({
    entry: ({ entryReads, time }) => ({
      instantlock: entryReads < 3 ? "false" : "true",
      time: Math.floor(time / 1000),
    }),
  });
  const result = await mine();
  assert.equal(state.entryReads, 3);
  assert.equal(state.sleeps, 2);
  assert.deepEqual(state.minedAt, [1_800_000_000_200]);
  assert.equal(result.synchronized, true);
  assert.equal(result.blockHeight, 124);
  assert.equal(result.waitedForTransactions, 1);
});

test("False or unknown InstantSend values time out without mining a fresh LAVE payment", async (t) => {
  for (const instantlock of ["false", "unknown", false, undefined]) {
    await t.test(String(instantlock), async () => {
      const { mine, state } = fixture({
        entry: ({ time }) => ({ instantlock, time: Math.floor(time / 1000) }),
      });
      await assert.rejects(mine(), {
        code: "PAYMENT_NOT_MINEABLE",
        status: 409,
      });
      assert.equal(state.time, 1_800_000_000_500);
      assert.equal(state.minedAt.length, 0);
      assert.equal(
        state.calls.some(({ method }) => method === "getnewaddress"),
        false,
      );
    });
  }
});

test("A boolean true lock and an already confirmed payment both remain eligible", async (t) => {
  await t.test("boolean lock", async () => {
    const { mine, state } = fixture({ entry: () => ({ instantlock: true }) });
    await mine();
    assert.equal(state.sleeps, 0);
    assert.equal(state.minedAt.length, 1);
  });
  await t.test("confirmed before the request", async () => {
    const { mine, state } = fixture({
      confirmed: true,
      entry: () => {
        throw MISSING();
      },
    });
    await mine();
    assert.equal(state.sleeps, 0);
    assert.equal(state.minedAt.length, 1);
  });
});

test("The real 600-second age permits only an attempt, with confirmation required afterwards", async (t) => {
  for (const autoConfirm of [true, false]) {
    await t.test(autoConfirm ? "included" : "excluded by Core", async () => {
      const { mine, state } = fixture({
        autoConfirm,
        entry: ({ time }) => ({
          instantlock: "false",
          time: Math.floor(time / 1000) - 600,
        }),
      });
      if (autoConfirm) {
        const result = await mine();
        assert.equal(result.synchronized, true);
      } else {
        await assert.rejects(mine(), {
          code: "PAYMENT_NOT_CONFIRMED",
          status: 409,
        });
      }
      assert.equal(state.entryReads, 1);
      assert.deepEqual(state.minedAt, [1_800_000_000_000]);
    });
  }
});

test("A 599-second or malformed mempool age cannot bypass the InstantSend wait", async (t) => {
  for (const age of [599, -1, undefined, "600"]) {
    await t.test(String(age), async () => {
      const { mine, state } = fixture({
        entry: () => ({
          instantlock: "false",
          time: typeof age === "number" ? 1_800_000_000 - age : age,
        }),
      });
      await assert.rejects(mine(), { code: "PAYMENT_NOT_MINEABLE" });
      assert.equal(state.minedAt.length, 0);
    });
  }
});

test("Missing relay or unsynchronized post-mine nodes never produce a settled response", async (t) => {
  await t.test("not relayed", async () => {
    const { mine, state } = fixture({
      entry: () => {
        throw MISSING();
      },
    });
    await assert.rejects(mine(), { code: "RELAY_TIMEOUT", status: 409 });
    assert.equal(state.minedAt.length, 0);
  });
  await t.test("nodes not synchronized", async () => {
    const { mine, state } = fixture({ synchronized: false });
    await assert.rejects(mine(), {
      code: "PAYMENT_NOT_CONFIRMED",
      status: 409,
    });
    assert.equal(state.minedAt.length, 1);
  });
});

test("Atlas retains relay-only eligibility for fresh transactions", async () => {
  const { mine, state } = fixture({
    profile: "atlas",
    entry: ({ time }) => ({ instantlock: "false", time: time / 1000 }),
  });
  const result = await mine();
  assert.equal(state.sleeps, 0);
  assert.equal(state.minedAt.length, 1);
  assert.equal(result.synchronized, true);
});

test("Mining without an invoice still works using the same limited credential", async () => {
  const { mine, state } = fixture();
  const result = await mine({ blocks: 2 });
  assert.equal(state.entryReads, 0);
  assert.equal(result.blockHeight, 125);
  assert.equal(result.waitedForTransactions, 0);
});
