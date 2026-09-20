import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  NAME,
  CHAIN,
  WALLET,
  GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  NODE_IDS,
  PUBLIC_DIR,
} from "./config.mjs";
import { rpc, assertNode } from "./rpc.mjs";
import { loadState, saveState, writeJson, progress } from "./state.mjs";
import {
  mine,
  preparePayment,
  broadcastPrepared,
  waitFor,
  waitForActiveConnections,
} from "./lifecycle.mjs";
import { publishStatus } from "./monitor.mjs";

async function isProof(txid) {
  const lock = await waitFor(
    async () => {
      const [candidate] = await rpc("miner", "getislocks", [[txid]]);
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
  const verified = await rpc("miner", "verifyislock", [
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
    "InstantSend lock did not propagate to all twenty payment nodes",
    60000,
  );
  const wrongTxid = (txid[0] === "0" ? "1" : "0") + txid.slice(1);
  assert.equal(
    await rpc("miner", "verifyislock", [lock.id, wrongTxid, lock.signature]),
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
async function chainProof(minHeight) {
  const lock = await waitFor(
    async () => {
      try {
        const value = await rpc("miner", "getbestchainlock");
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
  const verified = await rpc("miner", "verifychainlock", [
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
    "ChainLock did not propagate to all twenty payment nodes",
    60000,
  );
  const otherHash = await rpc("miner", "getblockhash", [lock.height - 1]);
  assert.equal(
    await rpc("miner", "verifychainlock", [
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
  const state = await loadState();
  if (!state.initializedAt)
    throw new Error("Start the payment seed masternodes before verification");
  await Promise.all(NODE_IDS.map(assertNode));
  await waitForActiveConnections(state);
  // Resume an interrupted proof using its exact durably saved transaction.
  let run = state.verificationRuns?.find((candidate) => !candidate.completedAt);
  if (!run) {
    run = { id: randomUUID(), startedAt: new Date().toISOString() };
    state.verificationRuns ||= [];
    state.verificationRuns.push(run);
    await saveState(state);
  }
  if (!run.transaction) {
    const address = await rpc(
      "miner",
      "getnewaddress",
      ["payment-quorum-proof"],
      WALLET,
    );
    run.transaction = await preparePayment([{ [address]: "1.00000000" }]);
    await saveState(state);
  }
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
    rewardProofs: [],
  };
  await writeJson(join(PUBLIC_DIR, "verification.json"), report);
  await progress(
    "verification",
    "Verifying actual InstantSend and ChainLock BLS signatures across the existing payment network and sixteen seed masternodes",
  );
  try {
    await broadcastPrepared(run.transaction);
    report.instantSend = await isProof(run.transaction.txid);
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    const transaction = await rpc(
      "miner",
      "gettransaction",
      [run.transaction.txid],
      WALLET,
    );
    if (!(transaction.confirmations > 0)) await mine(state, 1);
    report.chainLocks = await chainProof(await rpc("miner", "getblockcount"));
    const settled = await rpc(
      "miner",
      "gettransaction",
      [run.transaction.txid],
      WALLET,
    );
    assert.ok(
      settled.confirmations > 0 && settled.blockhash,
      "Proof transaction must actually confirm",
    );
    const header = await rpc("miner", "getblockheader", [settled.blockhash]);
    assert.equal(
      header.chainlock,
      true,
      "The payment's containing block must be ChainLocked",
    );
    report.payment = {
      txid: run.transaction.txid,
      confirmations: settled.confirmations,
      blockHash: settled.blockhash,
      chainLocked: true,
    };
    const snapshot = await publishStatus();
    report.rewardProofs = snapshot.rewardProofs.filter(
      (proof) => proof.verified === true,
    );
    assert.ok(
      report.rewardProofs.length > 0,
      "At least one seed masternode payout must be proven from its actual coinbase transaction",
    );
    report.passed = true;
    report.completedAt = new Date().toISOString();
    run.completedAt = report.completedAt;
    await saveState(state);
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    await publishStatus();
    await progress(
      "verified",
      "Payment InstantSend, ChainLocks and actual masternode coinbase rewards verified; existing chain history retained",
    );
    return report;
  } catch (error) {
    report.failedAt = new Date().toISOString();
    report.error =
      "Payment quorum proof did not complete; inspect the private operator output";
    await writeJson(join(PUBLIC_DIR, "verification.json"), report);
    await publishStatus();
    throw error;
  }
}
