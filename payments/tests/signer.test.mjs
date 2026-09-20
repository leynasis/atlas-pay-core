import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CustomerSigner, createPaymentRequest } from "../signer/service.mjs";
import { SignerStore } from "../signer/store.mjs";
import {
  inspectPsbt,
  requestDigest,
  validateRequest,
} from "../signer/policy.mjs";

const identity = {
  chain: "devnet-atlas-local-v1",
  devnetName: "atlas-local-v1",
  genesisHash: "0".repeat(64),
  devnetGenesisHash: "1".repeat(64),
};
const merchant = "yMerchant111111111111111111111111111";
const change = "yChange11111111111111111111111111111";
const funding = "yFunding1111111111111111111111111111";
const outpoint = { txid: "a".repeat(64), vout: 0 };
const now = Date.UTC(2026, 8, 20);

class FakeLab {
  constructor() {
    this.calls = [];
    this.locked = [];
    this.psbts = new Map();
    this.mempool = new Set();
    this.broadcastFailure = false;
    this.afterBroadcastFailure = false;
    this.chain = identity.chain;
    this.signCount = 0;
    this.sendCount = 0;
    this.count = 0;
  }
  transaction() {
    return {
      txid: "b".repeat(64),
      version: 3,
      type: 0,
      locktime: 0,
      size: 85,
      vin: [{ ...outpoint, sequence: 4294967295, scriptSig: { hex: "" } }],
      vout: [
        {
          n: 0,
          value: "0.25",
          scriptPubKey: { hex: "76aa", address: merchant },
        },
        {
          n: 1,
          value: "0.74999774",
          scriptPubKey: { hex: "76bb", address: change },
        },
      ],
    };
  }
  decoded() {
    return {
      psbt_version: 0,
      tx: this.transaction(),
      fee: "0.00000226",
      inputs: [
        {
          non_witness_utxo: {
            txid: outpoint.txid,
            vout: [
              { value: "1", scriptPubKey: { hex: "76cc", address: funding } },
            ],
          },
        },
      ],
      outputs: [{}, {}],
    };
  }
  rpc = async (node, method, params = [], wallet) => {
    this.calls.push({ node, method, params, wallet });
    switch (method) {
      case "getblockchaininfo":
        return { chain: this.chain, blocks: 112 };
      case "getblockhash":
        return params[0] ? identity.devnetGenesisHash : identity.genesisHash;
      case "getnewaddress":
        return merchant;
      case "getrawchangeaddress":
        return change;
      case "validateaddress":
        return { isvalid: true, scriptPubKey: "76aa" };
      case "getaddressinfo":
        return {
          ismine: params[0] !== merchant,
          ischange: params[0] === change,
          iswatchonly: false,
          scriptPubKey:
            params[0] === change
              ? "76bb"
              : params[0] === funding
                ? "76cc"
                : "76aa",
        };
      case "walletcreatefundedpsbt": {
        const psbt = `psbt-${++this.count}`;
        this.psbts.set(psbt, this.decoded());
        this.locked.push(outpoint);
        return { psbt, fee: "0.00000226", changepos: 1 };
      }
      case "decodepsbt":
        return structuredClone(this.psbts.get(params[0]));
      case "gettxout":
        return {
          confirmations: 12,
          value: "1",
          scriptPubKey: { hex: "76cc", address: funding },
        };
      case "lockunspent":
        if (params[0])
          this.locked = this.locked.filter(
            (item) =>
              !params[1].some(
                (point) => point.txid === item.txid && point.vout === item.vout,
              ),
          );
        return true;
      case "listlockunspent":
        return this.locked;
      case "walletprocesspsbt":
        this.signCount++;
        assert.deepEqual(params.slice(1), [true, "ALL", false, true]);
        return { complete: true, psbt: `${params[0]}-signed` };
      case "finalizepsbt":
        return { complete: true, hex: "deadbeef" };
      case "decoderawtransaction": {
        const tx = this.transaction();
        tx.txid = "c".repeat(64);
        tx.size = 226;
        tx.vin[0].scriptSig.hex = "00";
        return tx;
      }
      case "testmempoolaccept":
        return [{ allowed: true }];
      case "sendrawtransaction":
        this.sendCount++;
        if (this.broadcastFailure)
          throw new Error("Lost response before network delivery");
        this.mempool.add("c".repeat(64));
        if (this.afterBroadcastFailure)
          throw new Error("Lost response after broadcast");
        return "c".repeat(64);
      case "gettransaction":
        if (this.mempool.has(params[0]))
          return { confirmations: 0, details: [] };
        throw Object.assign(new Error("Missing"), { code: -5 });
      case "getmempoolentry":
        if (this.mempool.has(params[0])) return {};
        throw Object.assign(new Error("Missing"), { code: -5 });
      default:
        throw new Error(`Unexpected ${node}:${method}`);
    }
  };
}

async function setup(t, { path = ":memory:", lab = new FakeLab() } = {}) {
  let clock = now;
  const store = new SignerStore(path);
  t.after(() => store.close());
  const signer = new CustomerSigner({
    rpc: lab.rpc,
    identity,
    store,
    now: () => clock,
  });
  const request = await createPaymentRequest({
    rpc: lab.rpc,
    identity,
    amount: "0.25",
    merchantName: "Atlas",
    description: "Order",
    expiresInMinutes: 1,
    now,
  });
  return {
    lab,
    store,
    signer,
    request,
    advance: (ms) => {
      clock += ms;
    },
  };
}
const code = (value) => (error) => error.code === value;

test("Request binds exact money, named network and safe review text; altered imports are rejected", async (t) => {
  const { request } = await setup(t);
  assert.equal(validateRequest(request, identity, now), 25_000_000n);
  for (const [field, value] of [
    ["amount", "0.5"],
    ["address", change],
    ["network", { ...identity, chain: "main" }],
  ])
    assert.throws(
      () => validateRequest({ ...request, [field]: value }, identity, now),
      code("REQUEST_CHANGED"),
    );
  const inconsistent = { ...request, amount: "0.5" };
  inconsistent.requestHash = requestDigest(inconsistent);
  assert.throws(
    () => validateRequest(inconsistent, identity, now),
    code("AMOUNT_CHANGED"),
  );
  const wrong = {
    ...request,
    network: { ...identity, devnetGenesisHash: "f".repeat(64) },
  };
  wrong.requestHash = requestDigest(wrong);
  assert.throws(
    () => validateRequest(wrong, identity, now),
    code("WRONG_NETWORK"),
  );
  for (const text of [
    "merchant\x1b[2J",
    "merchant\u202etest",
    "merchant\x85test",
  ]) {
    const unsafe = { ...request, merchantName: text };
    unsafe.requestHash = requestDigest(unsafe);
    assert.throws(
      () => validateRequest(unsafe, identity, now),
      code("UNSAFE_TEXT"),
    );
  }
  assert.throws(
    () => validateRequest(request, identity, now + 60_000),
    code("REQUEST_EXPIRED"),
  );
  assert.throws(
    () => validateRequest([], identity, now),
    code("INVALID_REQUEST"),
  );
});

test("Unsigned PSBT policy rejects changed amount, unrelated output, excessive fee, unsafe sighash and fake UTXOs", async (t) => {
  const { request, signer, store, lab } = await setup(t);
  await signer.prepare(request);
  const record = store.get(request.id);
  const inspect = () =>
    inspectPsbt({
      request,
      psbt: record.psbt,
      changeAddress: change,
      rpc: lab.rpc,
      identity,
      now,
      expectedTemplateHash: record.templateHash,
    });
  const original = lab.psbts.get(record.psbt);
  for (const [mutate, expected] of [
    [
      (psbt) => {
        psbt.tx.vout[0].value = "0.3";
      },
      "AMOUNT_CHANGED",
    ],
    [
      (psbt) => {
        psbt.tx.vout[1].scriptPubKey.hex = "attacker";
      },
      "UNOWNED_CHANGE",
    ],
    [
      (psbt) => {
        psbt.tx.vout[1].value = "0.7";
        psbt.fee = "0.05";
      },
      "EXCESSIVE_FEE",
    ],
    [
      (psbt) => {
        psbt.inputs[0].sighash = "NONE|ANYONECANPAY";
      },
      "UNSAFE_SIGHASH",
    ],
    [
      (psbt) => {
        psbt.inputs[0].non_witness_utxo.vout[0].value = "2";
      },
      "UTXO_MISMATCH",
    ],
    [
      (psbt) => {
        psbt.tx.vin[0].sequence = 10;
      },
      "TRANSACTION_CHANGED",
    ],
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    lab.psbts.set(record.psbt, copy);
    await assert.rejects(inspect(), code(expected));
  }
  lab.psbts.set(record.psbt, original);
  assert.equal((await inspect()).amount, "0.25");
  assert.equal(lab.signCount, 0);
  assert.equal(lab.sendCount, 0);
});

test("No approval means no signing; expiry and node identity are rechecked after customer review", async (t) => {
  const { signer, request, lab, advance } = await setup(t);
  await signer.prepare(request);
  await assert.rejects(
    signer.approve(request.id, async () => false),
    code("APPROVAL_DENIED"),
  );
  await assert.rejects(signer.approve(request.id), code("APPROVAL_REQUIRED"));
  assert.equal(lab.signCount, 0);
  await assert.rejects(
    signer.approve(request.id, async () => {
      advance(60_000);
      return true;
    }),
    code("REQUEST_EXPIRED"),
  );
  assert.equal(lab.signCount, 0);
  assert.equal(lab.sendCount, 0);
  const other = await setup(t);
  await other.signer.prepare(other.request);
  await assert.rejects(
    other.signer.approve(other.request.id, async () => {
      other.lab.chain = "main";
      return true;
    }),
    code("WRONG_NETWORK"),
  );
  assert.equal(other.lab.signCount, 0);
});

test("Approval signs only customer wallet, stores exact tx and replays without another signature/payment", async (t) => {
  const { signer, request, lab } = await setup(t);
  const prepared = await signer.prepare(request);
  assert.equal(prepared.amount, "0.25");
  assert.equal(prepared.fee, "0.00000226");
  assert.equal(
    lab.calls.filter((call) => call.method === "walletcreatefundedpsbt").length,
    1,
  );
  await signer.prepare(request);
  let approvals = 0;
  const result = await signer.approve(request.id, async (review) => {
    approvals++;
    assert.equal(review.fingerprint, prepared.fingerprint);
    return true;
  });
  assert.equal(result.state, "broadcast");
  assert.equal(result.txid, "c".repeat(64));
  const replay = await signer.approve(request.id, async () => {
    throw new Error("Must not ask or sign twice");
  });
  assert.deepEqual(replay, result);
  assert.equal(approvals, 1);
  assert.equal(lab.signCount, 1);
  assert.equal(lab.sendCount, 1);
  assert.equal(
    lab.calls.find((call) => call.method === "walletprocesspsbt").node,
    "customer",
  );
  assert.equal(
    lab.calls.find((call) => call.method === "walletprocesspsbt").wallet,
    "customer",
  );
  await assert.rejects(signer.cancel(request.id), code("CANNOT_CANCEL"));
});

test("Lost broadcast response recovers by known tx or rebroadcasting identical bytes after restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-signer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lab = new FakeLab();
  const path = join(dir, "signer.sqlite");
  const first = new SignerStore(path);
  let signer = new CustomerSigner({
    rpc: lab.rpc,
    identity,
    store: first,
    now: () => now,
  });
  const request = await createPaymentRequest({
    rpc: lab.rpc,
    identity,
    amount: "0.25",
    merchantName: "Atlas",
    description: "Order",
    now,
  });
  await signer.prepare(request);
  lab.broadcastFailure = true;
  await assert.rejects(
    signer.approve(request.id, async () => true),
    code("BROADCAST_UNCERTAIN"),
  );
  const raw = first.get(request.id).rawHex;
  assert.equal(typeof raw, "string");
  first.close();
  const reopened = new SignerStore(path);
  t.after(() => reopened.close());
  signer = new CustomerSigner({
    rpc: lab.rpc,
    identity,
    store: reopened,
    now: () => now,
  });
  await assert.rejects(signer.cancel(request.id), code("CANNOT_CANCEL"));
  lab.broadcastFailure = false;
  lab.afterBroadcastFailure = true;
  await assert.rejects(
    signer.approve(request.id, async () => true),
    code("BROADCAST_UNCERTAIN"),
  );
  const recovered = await signer.approve(request.id, async () => {
    throw new Error("Transaction is already known");
  });
  assert.equal(recovered.state, "broadcast");
  assert.equal(lab.signCount, 1);
  assert.equal(lab.sendCount, 2);
  assert.deepEqual(
    lab.calls
      .filter((call) => call.method === "sendrawtransaction")
      .map((call) => call.params[0]),
    [raw, raw],
  );
});

test("Cancellation unlocks only the unsigned draft inputs and can replay safely", async (t) => {
  const { signer, request, lab } = await setup(t);
  await signer.prepare(request);
  const unrelated = { txid: "d".repeat(64), vout: 1 };
  lab.locked.push(unrelated);
  assert.equal((await signer.cancel(request.id)).state, "cancelled");
  assert.deepEqual(lab.locked, [unrelated]);
  await signer.cancel(request.id);
  await assert.rejects(
    signer.approve(request.id, async () => true),
    code("OPERATION_BUSY"),
  );
  assert.equal(lab.signCount, 0);
});

test("Read-only status follows confirmation, reorg, conflict and unavailable-chain states without changing the journal", async (t) => {
  const { signer, request, lab, store } = await setup(t);
  await signer.prepare(request);
  const unsigned = await signer.status(request.id);
  assert.equal(unsigned.state, "prepared");
  assert.equal(unsigned.confirmationState, "unknown");
  assert.equal(unsigned.confirmations, null);
  assert.equal(unsigned.chainAvailable, true);
  await signer.approve(request.id, async () => true);
  const saved = structuredClone(store.get(request.id));
  const callStart = lab.calls.length;
  let transaction = { confirmations: 0, details: [] };
  let inMempool = true;
  let unavailable = false;
  signer.rpc = async (node, method, params, wallet) => {
    if (unavailable)
      throw new Error("Sensitive local credential path must not be exposed");
    if (method === "gettransaction") {
      if (!transaction)
        throw Object.assign(new Error("Unknown transaction"), { code: -5 });
      return transaction;
    }
    if (method === "getmempoolentry") {
      if (!inMempool)
        throw Object.assign(new Error("Not in mempool"), { code: -5 });
      return {};
    }
    return lab.rpc(node, method, params, wallet);
  };
  for (const [confirmations, expected] of [
    [0, "pending"],
    [1, "confirmed"],
    [0, "pending"],
    [-1, "conflicted"],
  ]) {
    transaction = { confirmations, details: [] };
    const status = await signer.status(request.id);
    assert.equal(status.state, "broadcast");
    assert.equal(status.confirmationState, expected);
    assert.equal(status.confirmations, confirmations);
    assert.equal(status.chainAvailable, true);
  }
  transaction = { confirmations: 0, details: [{ abandoned: true }] };
  assert.equal(
    (await signer.status(request.id)).confirmationState,
    "conflicted",
  );
  transaction = { confirmations: 0, details: [] };
  inMempool = false;
  const absentFromMempool = await signer.status(request.id);
  assert.equal(absentFromMempool.confirmationState, "unknown");
  assert.equal(absentFromMempool.inMempool, false);
  transaction = null;
  assert.equal((await signer.status(request.id)).confirmations, null);
  unavailable = true;
  const offline = await signer.status(request.id);
  assert.equal(offline.state, "broadcast");
  assert.equal(offline.chainAvailable, false);
  assert.equal(offline.confirmationState, "unknown");
  assert.equal(offline.confirmations, null);
  assert.equal(offline.error.code, "CHAIN_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(offline), /Sensitive local credential/);
  unavailable = false;
  lab.chain = "main";
  const wrongChain = await signer.status(request.id);
  assert.equal(wrongChain.chainAvailable, false);
  assert.equal(wrongChain.confirmationState, "unknown");
  assert.equal(wrongChain.error.code, "WRONG_NETWORK");
  assert.deepEqual(store.get(request.id), saved);
  assert.ok(
    lab.calls
      .slice(callStart)
      .every((call) =>
        ["getblockchaininfo", "getblockhash"].includes(call.method),
      ),
  );
  assert.equal(lab.signCount, 1);
  assert.equal(lab.sendCount, 1);
});

test("CLI rejects noninteractive approval and has no --yes escape hatch", () => {
  const cwd = new URL("../", import.meta.url);
  const noninteractive = spawnSync(
    process.execPath,
    ["signer/cli.mjs", "approve", randomUUID()],
    { cwd, encoding: "utf8" },
  );
  assert.equal(noninteractive.status, 1);
  assert.match(noninteractive.stderr, /TTY_REQUIRED/);
  const bypass = spawnSync(
    process.execPath,
    ["signer/cli.mjs", "approve", randomUUID(), "--yes"],
    { cwd, encoding: "utf8" },
  );
  assert.equal(bypass.status, 1);
  assert.match(bypass.stderr, /Usage/);
});

test("A stored Atlas signing draft cannot be reviewed, approved or cancelled under a LAVE identity", async (t) => {
  const { signer, request, lab, store } = await setup(t);
  const review = await signer.prepare(request);
  assert.equal(review.currency, "DASH");
  const lave = new CustomerSigner({
    rpc: lab.rpc,
    store,
    identity: {
      chain: "devnet-lave-local-v1",
      devnetName: "lave-local-v1",
      genesisHash: "2".repeat(64),
      devnetGenesisHash: "3".repeat(64),
      currency: "LAVE",
    },
  });
  lab.calls.length = 0;
  let approvalCalled = false;
  await assert.rejects(lave.status(request.id), code("WRONG_NETWORK"));
  await assert.rejects(lave.cancel(request.id), code("WRONG_NETWORK"));
  await assert.rejects(
    lave.approve(request.id, () => {
      approvalCalled = true;
      return true;
    }),
    code("WRONG_NETWORK"),
  );
  assert.equal(approvalCalled, false);
  assert.equal(lab.calls.length, 0);
  assert.equal(store.get(request.id).state, "prepared");
  assert.deepEqual(store.get(request.id).request, request);
});
