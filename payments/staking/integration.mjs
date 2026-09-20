import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openRoleSigner } from "../signer/runtime.mjs";
import { SignerStore } from "../signer/store.mjs";
import { requestDigest } from "../signer/policy.mjs";
import { createWalletBackup, restoreWalletBackup } from "../backup/service.mjs";
import { recoveryState } from "../backup/gate.mjs";
import { openStaking } from "./runtime.mjs";
import { IDENTITY, STAKING_ROOT } from "./config.mjs";
import { outpointKey } from "./policy.mjs";
import { validateStakingJournal } from "./backup.mjs";

// Explicit modes keep this integration runner from accidentally funding or
// spending a wallet just because someone imports this module or asks for help.
const mode = process.argv[2],
  role = process.argv[3] || "merchant";
if (
  !["preflight", "run", "finish"].includes(mode) ||
  !["merchant", "customer"].includes(role)
) {
  console.log(
    "Usage: node staking/integration.mjs <preflight|run|finish> [merchant|customer]\npreflight requires less than 1000 available LAVE and makes no monetary mutations.\nrun uses existing 1000+fee funds, performs collateral/register/retire approvals, and leaves this role retired.\nfinish resumes lifecycle and retirement checks for an already registered node.\nNo faucet, mining, private-wallet restart or other-role mutation is performed; an independently coordinated miner must supply confirmation blocks.",
  );
  process.exitCode = mode && mode !== "--help" ? 1 : 0;
} else {
  const { signer, store } = await openRoleSigner(role);
  const staking = openStaking({ signer, store });
  const checks = [];
  let temp;
  function check(name) {
    checks.push(name);
    console.log(`PASS ${name}`);
  }
  async function waitFor(checker, label, timeout = 1200000) {
    const until = Date.now() + timeout;
    let progressAt = 0;
    while (Date.now() < until) {
      if (Date.now() - progressAt >= 60000) {
        console.log(`WAIT ${label}`);
        progressAt = Date.now();
      }
      const result = await checker();
      if (result) return result;
      await delay(5000);
    }
    throw new Error(
      `Timed out waiting for ${label}. No extra blocks or replacement transactions were created.`,
    );
  }
  async function finishRegistered(node, registered, originalRpc) {
    await staking.start({ nodeId: node.id });
    await waitFor(async () => {
      const status = await staking.status();
      return (
        status.nodes[0].online &&
        status.nodes[0].synchronized &&
        status.nodes[0].masternodeState === "READY"
      );
    }, "managed masternode READY state");
    check(
      "separate private managed node starts as the registered operator and reaches READY",
    );
    await staking.stop({ nodeId: node.id });
    assert((await staking.status()).nodes[0].collateralLocked);
    await staking.start({ nodeId: node.id });
    assert((await staking.status()).nodes[0].collateralLocked);
    check("managed node stop/start never unlocks collateral");
    let review = await staking.retirePrepare({ nodeId: node.id });
    await staking.cancel({ requestId: review.id });
    assert((await staking.status()).nodes[0].collateralLocked);
    review = await staking.retirePrepare({ nodeId: node.id });
    const retirement = staking.staking.get(review.id);
    const retiring = (await originalRpc(role, "decodepsbt", [retirement.psbt]))
      .tx;
    assert.equal(retiring.vin.length, 1);
    assert.equal(outpointKey(retiring.vin[0]), outpointKey(node.collateral));
    const retiringReview = await staking.retireApprove({
      requestId: review.id,
      fingerprint: review.fingerprint,
    });
    console.log(`BROADCAST retire ${retiringReview.txid}`);
    await waitFor(async () => {
      const status = await staking.status();
      return status.nodes[0].state === "retired";
    }, "collateral-spend confirmation");
    assert.equal(
      await originalRpc(role, "gettxout", [
        node.collateral.txid,
        node.collateral.vout,
        true,
      ]),
      null,
    );
    await assert.rejects(
      originalRpc(role, "protx", ["info", registered.txid]),
      (error) => [-5, -8].includes(error.code),
    );
    await staking.stop({ nodeId: node.id });
    assert.equal((await staking.status()).lockedAmount, "0");
    check(
      "retirement cancellation preserves lock; approved confirmed self-spend removes the deterministic masternode",
    );
  }
  try {
    const initial = await staking.status();
    assert.equal(initial.supported, true);
    assert.equal(initial.recoveryLocked, false);
    if (mode === "preflight") {
      assert.equal(
        staking.staking.state(),
        null,
        "Preflight expects a wallet with no staking state.",
      );
      assert(
        Number(initial.availableAmount) < 1000,
        "Preflight must run before funding this role.",
      );
      await assert.rejects(
        staking.prepare({ name: "Insufficient funds check" }),
        { code: "INSUFFICIENT_FUNDS" },
      );
      assert.equal(staking.staking.state(), null);
      check(
        "insufficient balance refuses collateral without allocating a node or auto-funding",
      );
    } else if (mode === "finish") {
      assert(
        initial.nodes[0]?.registered && initial.nodes[0].collateralLocked,
        "Finish requires existing registered collateral.",
      );
      const node = staking.staking.state();
      await finishRegistered(node, { txid: node.proTxHash }, signer.rpc);
    } else {
      assert(
        !initial.nodes.length ||
          initial.nodes.every(
            (node) => node.state === "retired" && !node.online,
          ),
        "Full integration requires a fresh or retired/stopped role; existing active collateral is preserved.",
      );
      assert(
        Number(initial.availableAmount) >= 1000.001,
        "Provide at least 1000.001 confirmed LAVE before this test. It never funds itself.",
      );
      let signatureCalls = 0,
        dropCollateralResponse = true,
        submitNoBroadcast = false;
      const originalRpc = signer.rpc;
      signer.rpc = async (...args) => {
        const [, method, params = []] = args;
        if (
          method === "walletprocesspsbt" ||
          (method === "protx" && params[0] === "register_submit")
        )
          signatureCalls++;
        if (method === "sendrawtransaction") {
          const saved = staking.staking
            .records()
            .find((record) => record.rawHex === params[0]);
          assert(
            saved?.txid,
            "Signed raw bytes and txid must exist durably before any broadcast.",
          );
          const result = await originalRpc(...args);
          console.log(`BROADCAST ${saved.kind} ${saved.txid}`);
          if (saved.kind === "collateral" && dropCollateralResponse) {
            dropCollateralResponse = false;
            throw new Error("Injected lost collateral broadcast response");
          }
          return result;
        }
        const result = await originalRpc(...args);
        if (method === "protx" && params[0] === "register_submit") {
          assert.equal(params[3], false);
          const tx = await originalRpc(role, "decoderawtransaction", [result]);
          await assert.rejects(
            originalRpc(role, "getmempoolentry", [tx.txid]),
            (error) => error.code === -5,
          );
          submitNoBroadcast = true;
        }
        return result;
      };
      let review = await staking.prepare({ name: "Merchant integration node" });
      assert.equal(review.kind, "collateral");
      assert.equal(signatureCalls, 0);
      const collateralRequest = staking.staking.get(review.id);
      const unsigned = await originalRpc(role, "decodepsbt", [
        collateralRequest.psbt,
      ]);
      assert(unsigned.tx.vin.every((input) => !input.scriptSig?.hex));
      await assert.rejects(
        staking.approve({ requestId: review.id, fingerprint: "0".repeat(64) }),
        { code: "APPROVAL_MISMATCH" },
      );
      assert.equal(signatureCalls, 0);
      check(
        "collateral preparation is unsigned and wrong fingerprint cannot authorize a signature",
      );
      await assert.rejects(
        staking.approve({
          requestId: review.id,
          fingerprint: review.fingerprint,
        }),
        { code: "BROADCAST_UNCERTAIN" },
      );
      const beforeRetry = staking.staking.get(review.id);
      review = await staking.approve({
        requestId: review.id,
        fingerprint: review.fingerprint,
      });
      assert.equal(review.txid, beforeRetry.txid);
      assert.equal(staking.staking.get(review.id).rawHex, beforeRetry.rawHex);
      assert.equal(signatureCalls, 1);
      check(
        "lost response retries exactly the saved signed collateral transaction",
      );
      await waitFor(async () => {
        const status = await staking.status();
        return status.nodes[0].state === "collateral_ready" && status;
      }, "collateral confirmation");
      await staking.reconcileLocks();
      const node = staking.staking.state();
      assert(
        (await originalRpc(role, "listlockunspent", [], role)).some(
          (coin) => outpointKey(coin) === outpointKey(node.collateral),
        ),
      );
      const request = {
        version: 1,
        id: randomUUID(),
        merchantName: "Collateral exclusion test",
        description:
          "Unsigned ordinary payment must not select masternode collateral",
        address: await originalRpc(
          role,
          "getnewaddress",
          ["staking-test-only"],
          role,
        ),
        amount: "0.001",
        amountSats: "100000",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        network: IDENTITY,
      };
      request.requestHash = requestDigest(request);
      const ordinary = await signer.prepare(request);
      assert(
        !store
          .get(ordinary.id)
          .outpoints.some(
            (coin) => outpointKey(coin) === outpointKey(node.collateral),
          ),
      );
      await signer.cancel(ordinary.id);
      check(
        "persistent collateral lock excludes its UTXO from ordinary payment selection",
      );
      await mkdir(STAKING_ROOT, { recursive: true, mode: 0o700 });
      temp = await mkdtemp(join(STAKING_ROOT, ".integration-backup-"));
      const password = randomBytes(24).toString("hex");
      const exported = await createWalletBackup({
        signer,
        store,
        journalPath: store.path,
        password,
      });
      assert(!exported.bytes.includes(Buffer.from(node.operator.secret)));
      const restored = await restoreWalletBackup({
        bytes: exported.bytes,
        password,
        directory: join(temp, "restored"),
        role,
        network: IDENTITY,
      });
      const recoveryStore = new SignerStore(restored.journalPath);
      try {
        assert(recoveryState(recoveryStore));
        assert.equal(
          validateStakingJournal(recoveryStore.db, IDENTITY).nodes,
          1,
        );
        const recovery = openStaking({ signer, store: recoveryStore });
        assert.equal(
          recovery.staking.state().operator.secret,
          node.operator.secret,
        );
        await assert.rejects(recovery.prepare(), { code: "RECOVERY_LOCKED" });
      } finally {
        recoveryStore.close();
      }
      check(
        "encrypted backup includes BLS operator and restored journal rejects staking mutations",
      );
      review = await staking.prepare();
      assert.equal(review.kind, "register");
      assert.equal(signatureCalls, 1);
      const prepared = staking.staking.get(review.id);
      const feeSource = await originalRpc(
        role,
        "getaddressinfo",
        [prepared.changeAddress],
        role,
      );
      assert.equal(feeSource.ismine, true);
      assert.equal(
        feeSource.ischange,
        true,
        "Registration fee change must remain internal, never return to an invoice address.",
      );
      const protx = await originalRpc(role, "decoderawtransaction", [
        prepared.unsignedHex,
      ]);
      assert(protx.vin.every((input) => !input.scriptSig?.hex));
      const registered = await staking.approve({
        requestId: review.id,
        fingerprint: review.fingerprint,
      });
      assert.equal(signatureCalls, 2);
      assert(submitNoBroadcast);
      check(
        "native ProReg preparation is unsigned; explicit second approval journals submit=false bytes before broadcast",
      );
      await waitFor(async () => {
        const status = await staking.status();
        return status.nodes[0].registered && status.nodes[0].canStart;
      }, "masternode registration confirmation");
      await finishRegistered(node, registered, originalRpc);
    }
    await mkdir(STAKING_ROOT, { recursive: true, mode: 0o700 });
    await writeFile(
      join(STAKING_ROOT, `integration-${role}-${mode}.json`),
      JSON.stringify(
        {
          profile: "lave",
          role,
          mode,
          network: IDENTITY,
          checkedAt: new Date().toISOString(),
          checks,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      `${checks.length} checks passed; no automatic funding or mining.`,
    );
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    store.close();
  }
}
