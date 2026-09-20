import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignerStore } from "../signer/store.mjs";
import { StakingService } from "../staking/service.mjs";
import { IDENTITY, stakingConfig, PEER_PORTS } from "../staking/config.mjs";
import {
  inspectTransaction,
  outpointKey,
  stakingTemplate,
} from "../staking/policy.mjs";
import {
  validateStakingJournal,
  signedTransactionId,
} from "../staking/backup.mjs";
import { formatAmount, rpcAmount } from "../server/money.mjs";
import { digest } from "../signer/policy.mjs";
import { waitForManagedExit } from "../staking/lifecycle.mjs";

test("managed stop waits for daemon exit after cookie and PID-file removal", async () => {
  let alive = true,
    waits = 0,
    offlineChecks = 0;
  await waitForManagedExit({
    pid: 23456,
    pidPath: "/owned/node/laved.pid",
    read: async () => {
      throw Object.assign(new Error(), { code: "ENOENT" });
    },
    probe: () => {
      if (!alive) throw Object.assign(new Error(), { code: "ESRCH" });
    },
    isOffline: async () => {
      offlineChecks++;
      return true;
    },
    sleep: async () => {
      waits++;
      alive = false;
    },
  });
  assert.equal(waits, 1);
  assert.equal(offlineChecks, 1);
});

test("managed shutdown fails closed while captured PID still exists", async () => {
  await assert.rejects(
    waitForManagedExit({
      pid: 23456,
      pidPath: "/owned/node/laved.pid",
      attempts: 2,
      read: async () => {
        throw Object.assign(new Error(), { code: "ENOENT" });
      },
      probe: () => {},
      isOffline: async () => true,
      sleep: async () => {},
    }),
    { code: "NODE_STOP_PENDING" },
  );
});

async function fixture(t, { balance = "1500" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lave-staking-unit-"));
  const store = new SignerStore(join(dir, "customer.sqlite"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const mempool = new Set();
  const calls = [],
    addresses = new Map(),
    coins = new Map(),
    locks = new Map(),
    transactions = new Map(),
    raws = new Map(),
    psbts = new Map();
  let serial = 0,
    signatures = 0,
    online = false,
    broadcastFailure = false,
    rewardHistory = [];
  const address = (change = false) => {
    const value = `L${String(++serial).padStart(30, "1")}`;
    addresses.set(value, {
      ismine: true,
      iswatchonly: false,
      ischange: change,
      scriptPubKey: `76${serial.toString(16).padStart(6, "0")}88ac`,
    });
    return value;
  };
  const fundingAddress = address();
  coins.set(`${"a".repeat(64)}:0`, {
    txid: "a".repeat(64),
    vout: 0,
    address: fundingAddress,
    amount: balance,
    confirmations: 5,
    spendable: true,
    safe: true,
  });
  const utxo = (coin) =>
    coin
      ? {
          value: coin.amount,
          confirmations: coin.confirmations,
          scriptPubKey: {
            address: coin.address,
            hex: addresses.get(coin.address).scriptPubKey,
          },
        }
      : null;
  const rpc = async (_role, method, params = [], wallet) => {
    calls.push({ method, params: structuredClone(params), wallet });
    switch (method) {
      case "getblockchaininfo":
        return {
          chain: IDENTITY.chain,
          blocks: 1500,
          bestblockhash: "b".repeat(64),
        };
      case "listunspent":
        return [...coins.values()].filter((coin) => coin.confirmations >= 1);
      case "listlockunspent":
        return [...locks.values()];
      case "lockunspent":
        for (const coin of params[1]) {
          if (params[0]) locks.delete(outpointKey(coin));
          else locks.set(outpointKey(coin), coin);
        }
        return true;
      case "gettxout":
        return utxo(coins.get(`${params[0]}:${params[1]}`));
      case "getaddressinfo":
        return addresses.get(params[0]) || { ismine: false };
      case "getnewaddress":
        return address();
      case "getrawchangeaddress":
        return address(true);
      case "bls":
        return { secret: "1".repeat(64), public: "2".repeat(96) };
      case "listtransactions":
        return rewardHistory.slice(params[2], params[2] + params[1]);
      case "walletcreatefundedpsbt": {
        const selected = params[0].length
          ? params[0]
          : [...coins.values()].filter((coin) => !locks.has(outpointKey(coin)));
        const total = selected.reduce(
            (sum, coin) => sum + rpcAmount(coins.get(outpointKey(coin)).amount),
            0n,
          ),
          fee = 1000n;
        const [destination, value] = Object.entries(params[1][0])[0];
        const amount =
          rpcAmount(value) -
          (params[3].subtractFeeFromOutputs.length ? fee : 0n);
        const outputs = [
          {
            n: 0,
            value: formatAmount(amount),
            scriptPubKey: {
              address: destination,
              hex: addresses.get(destination).scriptPubKey,
            },
          },
        ];
        if (total > amount + fee)
          outputs.push({
            n: 1,
            value: formatAmount(total - amount - fee),
            scriptPubKey: {
              address: params[3].changeAddress,
              hex: addresses.get(params[3].changeAddress).scriptPubKey,
            },
          });
        const tx = {
          version: 3,
          type: 0,
          locktime: 0,
          vin: selected.map(({ txid, vout }) => ({
            txid,
            vout,
            sequence: 0xffffffff,
            scriptSig: { hex: "" },
          })),
          vout: outputs,
        };
        const psbt = `psbt${++serial}`;
        psbts.set(psbt, {
          tx,
          inputs: selected.map(() => ({})),
          psbt_version: 0,
        });
        return { psbt };
      }
      case "decodepsbt":
        return structuredClone(psbts.get(params[0]));
      case "walletprocesspsbt":
        signatures++;
        return { psbt: params[0], complete: true };
      case "finalizepsbt": {
        const tx = structuredClone(psbts.get(params[0]).tx),
          hex = String(++serial).padStart(8, "0");
        tx.vin.forEach((input) => (input.scriptSig.hex = "aabb"));
        tx.txid = signedTransactionId(hex);
        raws.set(hex, tx);
        return { hex, complete: true };
      }
      case "decoderawtransaction":
        return structuredClone(raws.get(params[0]));
      case "gettransaction":
        if (transactions.has(params[0])) return transactions.get(params[0]);
        throw Object.assign(new Error("missing"), { code: -5 });
      case "getmempoolentry":
        if (mempool.has(params[0])) return {};
        throw Object.assign(new Error("missing"), { code: -5 });
      case "testmempoolaccept":
        return [{ allowed: true }];
      case "sendrawtransaction": {
        const tx = raws.get(params[0]);
        for (const input of tx.vin) {
          coins.delete(outpointKey(input));
          locks.delete(outpointKey(input));
        }
        for (const output of tx.vout)
          coins.set(`${tx.txid}:${output.n}`, {
            txid: tx.txid,
            vout: output.n,
            address: output.scriptPubKey.address,
            amount: output.value,
            confirmations: 0,
            spendable: true,
            safe: true,
          });
        transactions.set(tx.txid, { txid: tx.txid, confirmations: 0 });
        mempool.add(tx.txid);
        if (broadcastFailure) {
          broadcastFailure = false;
          throw new Error("lost response");
        }
        return tx.txid;
      }
      case "protx": {
        if (params[0] === "info")
          return { state: { pubKeyOperator: "2".repeat(96) } };
        if (params[0] === "register_prepare") {
          const source = [...coins.values()].find(
            (coin) =>
              coin.address === params[9] && !locks.has(outpointKey(coin)),
          );
          assert(source);
          const tx = {
            version: 3,
            type: 1,
            locktime: 0,
            vin: [
              {
                txid: source.txid,
                vout: source.vout,
                sequence: 0xffffffff,
                scriptSig: { hex: "" },
              },
            ],
            vout: [
              {
                n: 0,
                value: formatAmount(rpcAmount(source.amount) - 1000n),
                scriptPubKey: {
                  address: source.address,
                  hex: addresses.get(source.address).scriptPubKey,
                },
              },
            ],
            extraPayload: "ab".repeat(200) + "00",
            proRegTx: {
              version: 2,
              type: 0,
              collateralHash: params[1],
              collateralIndex: params[2],
              service: params[3][0],
              ownerAddress: params[4],
              pubKeyOperator: params[5],
              votingAddress: params[6],
              operatorReward: 0,
              payoutAddress: params[8],
              inputsHash: "3".repeat(64),
            },
          };
          const hex = "aa" + String(++serial).padStart(6, "0");
          raws.set(hex, tx);
          return {
            tx: hex,
            signMessage: "fixture ownership message",
            collateralAddress: coins.get(`${params[1]}:${params[2]}`).address,
          };
        }
        if (params[0] === "register_submit") {
          assert.equal(params[3], false);
          signatures++;
          const tx = structuredClone(raws.get(params[1])),
            hex = "bb" + String(++serial).padStart(6, "0");
          tx.vin.forEach((input) => (input.scriptSig.hex = "ccddee"));
          tx.extraPayload =
            tx.extraPayload.slice(0, -2) + "41" + "ff".repeat(65);
          tx.txid = signedTransactionId(hex);
          raws.set(hex, tx);
          return hex;
        }
        throw new Error("unexpected protx");
      }
      case "signmessage":
        return "fixture-signature";
      default:
        throw new Error(`Unexpected RPC ${method}`);
    }
  };
  const signer = {
    role: "customer",
    identity: IDENTITY,
    rpc,
    checkNetwork: async () => rpc("customer", "getblockchaininfo"),
  };
  const nodeManager = {
    inspect: async () => ({
      online,
      bestblockhash: "b".repeat(64),
      masternodeState: online ? "READY" : null,
      masternodeSynced: online,
      peerCount: online ? 2 : 0,
    }),
    start: async () => {
      online = true;
    },
    stop: async () => {
      online = false;
    },
  };
  const service = new StakingService({ signer, store, nodeManager });
  function confirm() {
    for (const coin of coins.values()) coin.confirmations = 5;
    for (const tx of transactions.values()) tx.confirmations = 5;
    mempool.clear();
  }
  return {
    service,
    store,
    signer,
    nodeManager,
    calls,
    addresses,
    coins,
    locks,
    transactions,
    mempool,
    raws,
    psbts,
    confirm,
    get signatures() {
      return signatures;
    },
    failBroadcast() {
      broadcastFailure = true;
    },
    setRewards(value) {
      rewardHistory = value;
    },
  };
}
async function collateral(f) {
  const review = await f.service.prepare({ name: "My node" });
  await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  f.confirm();
  return review;
}

test("role endpoints are fixed and seed peers are explicitly allowlisted", () => {
  assert.equal(stakingConfig("customer").service, "127.0.0.1:20211");
  assert.equal(stakingConfig("merchant").rpcPort, 20202);
  assert.throws(() => stakingConfig("../../miner"));
  assert(PEER_PORTS.includes(20416));
  assert(!PEER_PORTS.includes(9999));
});

test("insufficient funds cannot allocate keys, create collateral or mine", async (t) => {
  const f = await fixture(t, { balance: "999" });
  await assert.rejects(f.service.prepare({ name: "x" }), {
    code: "INSUFFICIENT_FUNDS",
  });
  assert.equal(f.service.staking.state(), null);
  assert(
    !f.calls.some((call) =>
      [
        "getnewaddress",
        "bls",
        "generatetoaddress",
        "walletcreatefundedpsbt",
      ].includes(call.method),
    ),
  );
  assert.equal((await f.service.status()).canPrepare, false);
});

test("prepare is unsigned, review hides private operator and fingerprint mismatch cannot sign", async (t) => {
  const f = await fixture(t);
  const review = await f.service.prepare({ name: "Review node" });
  assert.equal(review.kind, "collateral");
  assert.equal(review.collateralAmount, "1000");
  assert.equal(f.signatures, 0);
  assert(!JSON.stringify(review).includes("1".repeat(64)));
  assert.equal(f.locks.size, 1);
  await assert.rejects(
    f.service.approve({ requestId: review.id, fingerprint: "wrong" }),
    { code: "APPROVAL_MISMATCH" },
  );
  assert.equal(f.signatures, 0);
  assert.equal((await f.service.prepare()).id, review.id);
});

test("lost broadcast retries saved bytes exactly once and persists collateral reservation", async (t) => {
  const f = await fixture(t);
  const review = await f.service.prepare({ name: "Resilient" });
  f.failBroadcast();
  await assert.rejects(
    f.service.approve({
      requestId: review.id,
      fingerprint: review.fingerprint,
    }),
    { code: "BROADCAST_UNCERTAIN" },
  );
  assert.equal(f.signatures, 1);
  const stored = f.service.staking.get(review.id);
  assert(stored.rawHex);
  const retry = await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  assert.equal(retry.txid, stored.txid);
  assert.equal(f.signatures, 1);
  const node = f.service.staking.state();
  assert(f.locks.has(outpointKey(node.collateral)));
  assert.equal(
    f.calls.filter((call) => call.method === "sendrawtransaction").length,
    1,
  );
});

test("interrupted signing fails closed and never attempts a replacement signature", async (t) => {
  const f = await fixture(t);
  const review = await f.service.prepare();
  const record = f.service.staking.get(review.id);
  record.state = "signing";
  f.service.staking.put(record);
  await assert.rejects(
    f.service.approve({
      requestId: review.id,
      fingerprint: review.fingerprint,
    }),
    { code: "OPERATION_UNCERTAIN" },
  );
  assert.equal(f.signatures, 0);
  assert.throws(() => validateStakingJournal(f.store.db, IDENTITY), {
    code: "BACKUP_STATE_UNCERTAIN",
  });
});

test("registration has a second unsigned review and submit=false precedes durable broadcast", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const status = await f.service.status();
  assert.equal(status.nodes[0].state, "collateral_ready");
  assert.equal(status.canPrepare, true);
  assert.equal(status.nodes[0].canRegister, true);
  const review = await f.service.prepare();
  assert.equal(review.kind, "register");
  assert.equal(f.signatures, 1);
  const record = f.service.staking.get(review.id);
  const unsigned = f.raws.get(record.unsignedHex);
  assert(unsigned.vin.every((input) => input.scriptSig.hex === ""));
  const result = await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  assert(result.txid);
  assert.equal(f.signatures, 2);
  assert(
    f.calls.find(
      (call) => call.method === "protx" && call.params[0] === "register_submit",
    ).params[3] === false,
  );
  assert.equal(f.service.staking.state().proTxHash, result.txid);
  assert.equal(validateStakingJournal(f.store.db, IDENTITY).requests, 2);
});

test("registration rejects altered operator and exact payload after preparation", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const review = await f.service.prepare();
  const record = f.service.staking.get(review.id);
  f.raws.get(record.unsignedHex).proRegTx.pubKeyOperator = "4".repeat(96);
  await assert.rejects(
    f.service.approve({
      requestId: review.id,
      fingerprint: review.fingerprint,
    }),
    { code: "REGISTRATION_CHANGED" },
  );
  assert.equal(f.signatures, 1);
  f.raws.get(record.unsignedHex).proRegTx.pubKeyOperator = "2".repeat(96);
  f.raws.get(record.unsignedHex).extraPayload =
    "cd" + f.raws.get(record.unsignedHex).extraPayload.slice(2);
  await assert.rejects(
    f.service.approve({
      requestId: review.id,
      fingerprint: review.fingerprint,
    }),
    { code: "TRANSACTION_CHANGED" },
  );
  assert.equal(f.signatures, 1);
});

test("stop and retirement cancellation retain collateral; approved spend releases only after confirmation", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  await f.service.reconcileLocks();
  let node = f.service.staking.state();
  await f.service.stop({ nodeId: node.id });
  assert(f.locks.has(outpointKey(node.collateral)));
  let review = await f.service.retirePrepare({ nodeId: node.id });
  assert.equal(review.kind, "retire");
  await f.service.cancel({ requestId: review.id });
  assert(f.locks.has(outpointKey(node.collateral)));
  review = await f.service.retirePrepare({ nodeId: node.id });
  await f.service.retireApprove({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  let status = await f.service.status();
  assert.equal(status.nodes[0].state, "retire_pending");
  assert.equal(status.lockedAmount, "1000");
  f.confirm();
  status = await f.service.status();
  assert.equal(status.nodes[0].state, "retired");
  assert.equal(status.lockedAmount, "0");
  const retired = f.service.staking.state().retirementTxid;
  f.transactions.get(retired).confirmations = 0;
  status = await f.service.status();
  assert.equal(status.nodes[0].state, "retire_pending");
  assert.equal(status.lockedAmount, "1000");
});

test("reapply restores lost native collateral lock and ordinary available coins exclude it", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const node = f.service.staking.state();
  f.locks.clear();
  await f.service.reconcileLocks();
  assert(f.locks.has(outpointKey(node.collateral)));
  assert(
    !(await f.service.available()).some(
      (coin) => outpointKey(coin) === outpointKey(node.collateral),
    ),
  );
  assert.equal((await f.service.status()).lockedAmount, "1000");
});

test("recovery locks all staking mutations while status remains inspectable", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  f.store.db.exec(
    "CREATE TABLE backup_recovery(id INTEGER PRIMARY KEY,data TEXT NOT NULL)",
  );
  f.store.db
    .prepare("INSERT INTO backup_recovery VALUES(1,?)")
    .run(JSON.stringify({ policy: "saved-transactions-only" }));
  for (const operation of [
    () => f.service.prepare(),
    () => f.service.start({ nodeId: "customer-local" }),
    () => f.service.stop({ nodeId: "customer-local" }),
    () => f.service.retirePrepare({ nodeId: "customer-local" }),
  ])
    await assert.rejects(operation(), { code: "RECOVERY_LOCKED" });
  assert.equal((await f.service.status()).recoveryLocked, true);
});

test("reward accounting accepts only payout coinbase receipts and distinguishes maturity", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const node = f.service.staking.state();
  f.setRewards([
    {
      txid: "c".repeat(64),
      vout: 1,
      address: node.payoutAddress,
      category: "generate",
      amount: "1.5",
      confirmations: 110,
    },
    {
      txid: "d".repeat(64),
      vout: 1,
      address: node.payoutAddress,
      category: "immature",
      amount: "0.5",
      confirmations: 4,
    },
    {
      txid: "e".repeat(64),
      vout: 0,
      address: node.payoutAddress,
      category: "receive",
      amount: "100",
      confirmations: 2,
    },
    {
      txid: "f".repeat(64),
      vout: 0,
      address: node.payoutAddress,
      category: "orphan",
      amount: "200",
      confirmations: 0,
    },
  ]);
  const status = await f.service.status();
  assert.equal(status.rewardsAmount, "1.5");
  assert.equal(status.immatureRewardsAmount, "0.5");
});

test("backup rejects signed bytes changed independently of saved txid", async (t) => {
  const f = await fixture(t);
  const review = await collateral(f);
  const record = f.service.staking.get(review.id);
  record.rawHex += "ff";
  f.service.staking.put(record);
  assert.throws(() => validateStakingJournal(f.store.db, IDENTITY), {
    code: "BACKUP_STATE_UNCERTAIN",
  });
});

test("missing registration fee fails without stranding a preparing journal", async (t) => {
  const f = await fixture(t, { balance: "1000.0001" });
  await collateral(f);
  await f.service.reconcileLocks();
  const node = f.service.staking.state();
  for (const [key] of f.coins)
    if (key !== outpointKey(node.collateral)) f.coins.delete(key);
  await assert.rejects(f.service.prepare(), {
    code: "INSUFFICIENT_PRIVATE_FEE_INPUT",
  });
  assert.equal(f.service.staking.pending(node.generation), null);
  assert.equal(f.signatures, 1);
});

test("backup keeps legacy journals without staking tables compatible", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lave-staking-legacy-"));
  const store = new SignerStore(join(dir, "legacy.sqlite"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(validateStakingJournal(store.db, IDENTITY), {
    nodes: 0,
    requests: 0,
  });
});

test("all absent or malformed approval fingerprints fail before any signature", async (t) => {
  const f = await fixture(t);
  let review = await f.service.prepare();
  for (const fingerprint of [
    undefined,
    null,
    "",
    "z".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    123,
  ]) {
    await assert.rejects(
      f.service.approve({ requestId: review.id, fingerprint }),
      { code: "APPROVAL_MISMATCH" },
    );
    assert.equal(f.signatures, 0);
  }
  await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  f.confirm();
  await f.service.reconcileLocks();
  review = await f.service.retirePrepare({ nodeId: "customer-local" });
  for (const fingerprint of [undefined, null, "bad"]) {
    await assert.rejects(
      f.service.retireApprove({ requestId: review.id, fingerprint }),
      { code: "APPROVAL_MISMATCH" },
    );
    assert.equal(f.signatures, 1);
  }
});

test("persisted confirmed retirement reorg exposes exact retry after mempool eviction", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  await f.service.reconcileLocks();
  const node = f.service.staking.state();
  const collateralCoin = structuredClone(
    f.coins.get(outpointKey(node.collateral)),
  );
  const review = await f.service.retirePrepare({ nodeId: node.id });
  await f.service.retireApprove({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  f.confirm();
  await f.service.reconcileLocks();
  assert.equal(f.service.staking.get(review.id).state, "confirmed");
  const saved = f.service.staking.get(review.id),
    signatures = f.signatures;
  f.transactions.get(saved.txid).confirmations = 0;
  f.mempool.delete(saved.txid);
  f.coins.set(outpointKey(node.collateral), collateralCoin);
  let status = await f.service.status();
  assert.equal(status.pendingReview.id, review.id);
  assert.equal(status.pendingReview.state, "broadcast_unknown");
  await f.service.reconcileLocks();
  assert.equal(f.service.staking.get(review.id).state, "broadcast_unknown");
  assert(f.locks.has(outpointKey(node.collateral)));
  await f.service.retireApprove({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  assert.equal(f.signatures, signatures);
  assert.equal(f.service.staking.get(review.id).rawHex, saved.rawHex);
  assert.equal(f.service.staking.get(review.id).txid, saved.txid);
  assert(f.mempool.has(saved.txid));
});

test("new generation requires actual ChainLock finality of prior retirement", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  await f.service.reconcileLocks();
  const old = f.service.staking.state();
  const review = await f.service.retirePrepare({ nodeId: old.id });
  const retired = await f.service.retireApprove({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  f.confirm();
  await f.service.reconcileLocks();
  assert.equal(
    (await f.service.status()).prepareDisabledReason,
    "RETIREMENT_FINALITY_PENDING",
  );
  await assert.rejects(f.service.prepare({ name: "Replacement" }), {
    code: "RETIREMENT_FINALITY_PENDING",
  });
  assert.equal(f.service.staking.state().generation, old.generation);
  assert.equal(f.service.staking.state().operator.secret, old.operator.secret);
  f.transactions.get(retired.txid).chainlock = true;
  const next = await f.service.prepare({ name: "Replacement" });
  assert.equal(next.kind, "collateral");
  assert.notEqual(f.service.staking.state().generation, old.generation);
});

test("confirmed registration reorg and eviction retries its saved transaction without another signature", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const review = await f.service.prepare();
  const prepared = f.service.staking.get(review.id);
  const feeCoins = prepared.outpoints.map((coin) =>
    structuredClone(f.coins.get(outpointKey(coin))),
  );
  const result = await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  f.confirm();
  await f.service.reconcileLocks();
  assert.equal(f.service.staking.get(review.id).state, "confirmed");
  const signed = f.service.staking.get(review.id),
    count = f.signatures;
  f.transactions.get(result.txid).confirmations = 0;
  f.mempool.delete(result.txid);
  for (const coin of feeCoins) f.coins.set(outpointKey(coin), coin);
  let status = await f.service.status();
  assert.equal(status.nodes[0].state, "registration_pending");
  assert.equal(status.pendingReview.id, review.id);
  assert.equal(status.pendingReview.state, "broadcast_unknown");
  await f.service.approve({
    requestId: review.id,
    fingerprint: review.fingerprint,
  });
  assert.equal(f.signatures, count);
  assert.equal(f.service.staking.get(review.id).rawHex, signed.rawHex);
  assert.equal(f.service.staking.get(review.id).txid, signed.txid);
  assert(f.mempool.has(result.txid));
});

test("backup staking role must match the encrypted archive role", async (t) => {
  const f = await fixture(t);
  await f.service.prepare();
  assert.equal(
    validateStakingJournal(f.store.db, IDENTITY, "customer").nodes,
    1,
  );
  assert.throws(
    () => validateStakingJournal(f.store.db, IDENTITY, "merchant"),
    { code: "BACKUP_IDENTITY_MISMATCH" },
  );
});

test("isolated READY daemon at the same chain tip is not synchronized", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  f.nodeManager.inspect = async () => ({
    online: true,
    bestblockhash: "b".repeat(64),
    masternodeState: "READY",
    masternodeSynced: true,
    peerCount: 0,
  });
  let status = await f.service.status();
  assert.equal(status.nodes[0].online, true);
  assert.equal(status.nodes[0].synchronized, false);
  f.nodeManager.inspect = async () => ({
    online: true,
    bestblockhash: "b".repeat(64),
    masternodeState: "READY",
    masternodeSynced: false,
    peerCount: 2,
  });
  status = await f.service.status();
  assert.equal(status.nodes[0].synchronized, false);
});

test("registration fee selection skips earlier invoice receipts and uses internal change", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  const invoice = await f.signer.rpc(
    "customer",
    "getnewaddress",
    ["historical invoice"],
    "customer",
  );
  const existing = [...f.coins];
  f.coins.clear();
  f.coins.set(`${"9".repeat(64)}:0`, {
    txid: "9".repeat(64),
    vout: 0,
    address: invoice,
    amount: "0.05",
    confirmations: 12,
    spendable: true,
    safe: true,
  });
  for (const [key, value] of existing) f.coins.set(key, value);
  const review = await f.service.prepare();
  assert.equal(review.kind, "register");
  const record = f.service.staking.get(review.id);
  assert.notEqual(record.changeAddress, invoice);
  assert.equal(f.addresses.get(record.changeAddress).ischange, true);
  assert(!record.outpoints.some((coin) => coin.txid === "9".repeat(64)));
});

test("registration with only invoice-address fees fails before creating a journal entry", async (t) => {
  const f = await fixture(t);
  await collateral(f);
  await f.service.reconcileLocks();
  const node = f.service.staking.state();
  for (const coin of f.coins.values())
    if (outpointKey(coin) !== outpointKey(node.collateral))
      f.addresses.get(coin.address).ischange = false;
  const status = await f.service.status();
  assert.equal(status.canPrepare, false);
  assert.equal(status.prepareDisabledReason, "INSUFFICIENT_PRIVATE_FEE_INPUT");
  await assert.rejects(f.service.prepare(), {
    code: "INSUFFICIENT_PRIVATE_FEE_INPUT",
  });
  assert.equal(f.service.staking.pending(node.generation), null);
  assert.equal(f.signatures, 1);
});
