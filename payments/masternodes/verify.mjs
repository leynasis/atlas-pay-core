import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  NAME,
  CHAIN,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  NODE_IDS,
  MN_IDS,
  PUBLIC_DIR,
} from "./config.mjs";
import { rpc, assertNode } from "./rpc.mjs";
import { loadState, saveState, writeJson, progress } from "./state.mjs";
import {
  startLab,
  mineQuorums,
  mine,
  preparePayment,
  broadcastPrepared,
  stopNode,
  startNode,
  connectNodes,
  setClock,
  waitFor,
  waitForActiveConnections,
} from "./lifecycle.mjs";
import { publishStatus } from "./monitor.mjs";

async function isProof(state, txid) {
  const lock = await waitFor(
    async () => {
      await setClock(state, 1);
      const [candidate] = await rpc("controller", "getislocks", [[txid]]);
      return candidate &&
        typeof candidate === "object" &&
        candidate.txid === txid
        ? candidate
        : false;
    },
    "InstantSend lock was not recovered",
    90000,
    1000,
  );
  const verified = await rpc("controller", "verifyislock", [
    lock.id,
    txid,
    lock.signature,
  ]);
  assert.equal(
    verified,
    true,
    "BLS InstantSend proof must verify cryptographically",
  );
  await waitFor(
    async () => {
      const proofs = await Promise.all(
        NODE_IDS.map((id) => rpc(id, "getislocks", [[txid]])),
      );
      return proofs.every(
        ([proof]) =>
          typeof proof === "object" && proof?.signature === lock.signature,
      );
    },
    "InstantSend lock did not propagate to all nine lab nodes",
    60000,
  );
  const wrongTxid = (txid[0] === "0" ? "1" : "0") + txid.slice(1);
  assert.equal(
    await rpc("controller", "verifyislock", [
      lock.id,
      wrongTxid,
      lock.signature,
    ]),
    false,
    "InstantSend proof must reject a changed transaction id",
  );
  return {
    txid,
    requestId: lock.id,
    cycleHash: lock.cycleHash,
    signature: lock.signature,
    verified,
    observedNodes: NODE_IDS.length,
    changedTransactionRejected: true,
    observedAt: new Date().toISOString(),
  };
}
async function chainProof(state, minHeight) {
  const lock = await waitFor(
    async () => {
      await setClock(state, 1);
      try {
        const value = await rpc("controller", "getbestchainlock");
        return value.height >= minHeight ? value : false;
      } catch (error) {
        if (error.code === -32603) return false;
        throw error;
      }
    },
    "ChainLock was not recovered for the new block",
    90000,
    1000,
  );
  const verified = await rpc("controller", "verifychainlock", [
    lock.blockhash,
    lock.signature,
    lock.height,
  ]);
  assert.equal(
    verified,
    true,
    "BLS ChainLock proof must verify cryptographically",
  );
  await waitFor(
    async () => {
      const blocks = await Promise.all(
        NODE_IDS.map((id) => rpc(id, "getblockheader", [lock.blockhash])),
      );
      return blocks.every((block) => block.chainlock === true);
    },
    "ChainLock did not propagate to all nine lab nodes",
    60000,
  );
  const otherHash = await rpc("controller", "getblockhash", [lock.height - 1]);
  assert.equal(
    await rpc("controller", "verifychainlock", [
      otherHash,
      lock.signature,
      lock.height,
    ]),
    false,
    "ChainLock must reject a different block hash",
  );
  return {
    height: lock.height,
    blockHash: lock.blockhash,
    signature: lock.signature,
    verified,
    observedNodes: NODE_IDS.length,
    changedBlockRejected: true,
    observedAt: new Date().toISOString(),
  };
}
export async function verifyLab() {
  const state = await startLab();
  await mineQuorums(state);
  await Promise.all(NODE_IDS.map(assertNode));
  await waitForActiveConnections(state);
  // Resume any exact test transactions left unconfirmed by an interrupted run.
  // Creating a new child payment before reannouncing its parent can strand it.
  let recoveredPending = false;
  for (const previous of state.verificationRuns || []) {
    for (const transaction of previous.transactions) {
      const known = await rpc("controller", "getrawtransaction", [
        transaction.txid,
        true,
      ]);
      if (known.confirmations > 0) continue;
      await broadcastPrepared(transaction);
      recoveredPending = true;
    }
  }
  if (recoveredPending) {
    await setClock(state, 601);
    await mine(state, 1, { pace: 1100 });
    await chainProof(state, await rpc("controller", "getblockcount"));
  }
  const run = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    transactions: [],
  };
  state.verificationRuns ||= [];
  state.verificationRuns.push(run);
  await saveState(state);
  const report = {
    format: 1,
    runId: run.id,
    name: NAME,
    chain: CHAIN,
    genesisHash: GENESIS_HASH,
    devnetGenesisHash: DEVNET_GENESIS_HASH,
    localOnly: true,
    startedAt: run.startedAt,
    passed: false,
    instantSend: null,
    chainLocks: null,
    failure: null,
    recovery: null,
  };
  await writeJson(join(PUBLIC_DIR, "verification.json"), report);
  let stopped = false;
  const payment = async () => {
    const address = await rpc(
      "controller",
      "getnewaddress",
      ["quorum-proof-test"],
      "controller",
    );
    const transaction = await preparePayment([{ [address]: "1.00000000" }]);
    run.transactions.push(transaction);
    await saveState(state);
    return transaction;
  };
  try {
    await progress(
      "verification",
      "Verifying real InstantSend and ChainLock BLS signatures on all nine nodes",
    );
    const baseline = await payment();
    await broadcastPrepared(baseline);
    report.instantSend = await isProof(state, baseline.txid);
    await mine(state, 1, { pace: 1100 });
    report.chainLocks = await chainProof(
      state,
      await rpc("controller", "getblockcount"),
    );
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    const outagePayment = await payment();
    await progress(
      "failure-test",
      "Stopping all eight local masternodes to verify that fresh locks require quorum participation",
    );
    stopped = true;
    await Promise.all(MN_IDS.map(stopNode));
    const oldLock = await rpc("controller", "getbestchainlock");
    await broadcastPrepared(outagePayment);
    await mine(state, 1, { ids: ["controller"] });
    const outageHeight = await rpc("controller", "getblockcount");
    const started = Date.now();
    while (Date.now() - started < 12000) {
      await setClock(state, 1, ["controller"]);
      const [lock] = await rpc("controller", "getislocks", [
        [outagePayment.txid],
      ]);
      assert.equal(
        typeof lock,
        "string",
        "No new InstantSend lock should appear without any masternodes",
      );
      const chainLock = await rpc("controller", "getbestchainlock");
      assert.ok(
        chainLock.height < outageHeight,
        "No fresh ChainLock should appear without any masternodes",
      );
      await delay(1000);
    }
    report.failure = {
      passed: true,
      kind: "all-masternodes-offline",
      offlineMasternodes: 8,
      observationMilliseconds: Date.now() - started,
      txid: outagePayment.txid,
      instantSendAbsent: true,
      oldChainLockHeight: oldLock.height,
      newUnprotectedHeight: outageHeight,
      newChainLockAbsent: true,
    };
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    await progress(
      "recovery",
      "Restarting masternodes and verifying restored InstantSend and ChainLocks",
    );
    await Promise.all(MN_IDS.map((id) => startNode(id, state)));
    await connectNodes();
    await setClock(state, 1);
    stopped = false;
    await mine(state, 1, { pace: 1100 });
    await waitForActiveConnections(state);
    // The controller had no peers when this exact journaled transaction was
    // broadcast. Reannounce it after the masternodes have reconnected.
    await broadcastPrepared(outagePayment);
    // A signing attempt made before quorum peers reconnected may time out.
    // Confirm the outage payment using Core's existing ten-minute safety rule,
    // then prove InstantSend recovery with a fresh post-reconnect payment.
    await setClock(state, 601);
    await mine(state, 1, { pace: 1100 });
    const outageRecoveryCL = await chainProof(
      state,
      await rpc("controller", "getblockcount"),
    );
    const settledOutage = await rpc("controller", "getrawtransaction", [
      outagePayment.txid,
      true,
    ]);
    assert.ok(
      settledOutage.confirmations > 0 && settledOutage.chainlock === true,
      "Outage payment must be confirmed under the recovered ChainLock",
    );
    const freshRecoveryPayment = await payment();
    await broadcastPrepared(freshRecoveryPayment);
    const recoveredIS = await isProof(state, freshRecoveryPayment.txid);
    await mine(state, 1, { pace: 1100 });
    const recoveredCL = await chainProof(
      state,
      await rpc("controller", "getblockcount"),
    );
    report.recovery = {
      passed: true,
      outagePaymentConfirmedUnderChainLock: outageRecoveryCL,
      instantSend: recoveredIS,
      chainLocks: recoveredCL,
    };
    report.passed = true;
    report.completedAt = new Date().toISOString();
    run.completedAt = report.completedAt;
    run.passed = true;
    await saveState(state);
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    await publishStatus();
    await progress(
      "verified",
      "Real DKG, InstantSend, ChainLocks, outage detection and recovery verified on isolated LAVE-Q",
    );
    console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    report.failedAt = new Date().toISOString();
    report.error = error.message;
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    throw error;
  } finally {
    if (stopped) {
      await Promise.all(MN_IDS.map((id) => startNode(id, state)));
      await connectNodes();
    }
  }
}
