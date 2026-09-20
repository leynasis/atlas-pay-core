import { randomUUID } from "node:crypto";
import { formatAmount, rpcAmount } from "../server/money.mjs";
import {
  canonical,
  digest,
  requirePolicy,
  SignerError,
} from "../signer/policy.mjs";
import { recoveryState, withWalletGate } from "../backup/gate.mjs";
import {
  IDENTITY,
  COLLATERAL,
  COLLATERAL_SATS,
  MAX_FEE_SATS,
  stakingConfig,
} from "./config.mjs";
import { StakingStore } from "./store.mjs";
import { managedNode } from "./lifecycle.mjs";
import {
  inspectTransaction,
  outpointKey,
  reviewFingerprint,
  stakingTemplate,
} from "./policy.mjs";

export class StakingService {
  constructor({ signer, store, nodeManager, now = () => Date.now() }) {
    this.signer = signer;
    this.store = store;
    this.role = signer.role;
    this.config = stakingConfig(this.role);
    this.staking = new StakingStore(store, this.role);
    this.manager = nodeManager || managedNode(this.role);
    this.now = now;
    this.rpc = (method, params = [], wallet = false) =>
      signer.rpc(this.role, method, params, wallet ? this.role : undefined);
  }
  supported() {
    return canonical(this.signer.identity) === canonical(IDENTITY);
  }
  async gate(operation, { mutation = true } = {}) {
    return withWalletGate(this.store.path, async () => {
      requirePolicy(
        this.supported(),
        "STAKING_UNSUPPORTED",
        "Wallet masternodes support only the pinned LAVE payment chain.",
      );
      if (mutation)
        requirePolicy(
          !recoveryState(this.store),
          "RECOVERY_LOCKED",
          "Recovered wallets cannot change masternodes or create signatures; reconcile their later history first.",
        );
      await this.signer.checkNetwork();
      return operation();
    });
  }
  review(record, node = this.staking.state()) {
    return {
      id: record.id,
      nodeId: node.id,
      name: node.name,
      kind: record.kind,
      state: record.state,
      fingerprint: record.fingerprint || null,
      collateralAmount: COLLATERAL,
      fee: record.fee || null,
      total: record.total || null,
      collateralAddress: node.collateralAddress,
      payoutAddress: node.payoutAddress,
      service: node.service,
      network: IDENTITY,
      currency: "LAVE",
      expiresAt: record.expiresAt,
      txid: record.txid || null,
      confirmations: record.confirmations ?? null,
      ownerAddress: node.ownerAddress,
      votingAddress: node.votingAddress,
      operatorPublicKey: node.operator.public,
      returnAddress: record.returnAddress || null,
    };
  }
  async coinLock(outpoints, locked = true) {
    if (!outpoints.length) return;
    const current = await this.rpc("listlockunspent", [], true);
    const selected = locked
      ? outpoints
      : outpoints.filter((coin) =>
          current.some((item) => outpointKey(item) === outpointKey(coin)),
        );
    if (selected.length)
      await this.rpc("lockunspent", [!locked, selected, true], true);
  }
  async available() {
    const [coins, locks] = await Promise.all([
      this.rpc("listunspent", [1, 9999999], true),
      this.rpc("listlockunspent", [], true),
    ]);
    const reserved = new Set(locks.map(outpointKey));
    const node = this.staking.state();
    if (node?.collateral) reserved.add(outpointKey(node.collateral));
    return coins.filter(
      (coin) =>
        coin.spendable &&
        coin.safe !== false &&
        !reserved.has(outpointKey(coin)),
    );
  }
  async registrationSource(coins) {
    for (const coin of coins) {
      if (rpcAmount(coin.amount) < MAX_FEE_SATS) continue;
      const info = await this.rpc("getaddressinfo", [coin.address], true);
      if (info.ismine === true && !info.iswatchonly && info.ischange === true)
        return coin;
    }
    return null;
  }
  async known(txid) {
    try {
      return await this.rpc("gettransaction", [txid], true);
    } catch (error) {
      if (error.code === -5) return null;
      throw error;
    }
  }
  async refresh(node, { persist = false } = {}) {
    if (!node) return null;
    const records = this.staking
      .records()
      .filter((record) => record.generation === node.generation);
    let conflict = false;
    for (const record of records) {
      if (!record.txid) continue;
      const transaction = await this.known(record.txid);
      record.confirmations = transaction?.confirmations ?? 0;
      if (transaction?.confirmations >= 1) record.state = "confirmed";
      else {
        if (transaction?.confirmations < 0 || transaction?.abandoned)
          conflict = true;
        const inMempool = await this.inMempool(record.txid);
        // A missing or evicted transaction always keeps its original signed
        // bytes. Reorganization never permits a replacement signature.
        record.state = inMempool
          ? "broadcast"
          : record.state === "signed"
            ? "signed"
            : "broadcast_unknown";
      }
      if (persist) this.staking.put(record);
    }
    const signed = records.filter((record) => record.txid);
    const unresolved = signed.find((record) => record.state !== "confirmed");
    const collateral = signed.find((record) => record.kind === "collateral");
    const registration = signed.find((record) => record.kind === "register");
    const retirement = signed.find((record) => record.kind === "retire");
    if (unresolved)
      node.phase = {
        collateral: "collateral_pending",
        register: "registration_pending",
        retire: "retire_pending",
      }[unresolved.kind];
    else if (retirement) node.phase = "retired";
    else if (registration) node.phase = "registered";
    else if (collateral) node.phase = "collateral_ready";
    else node.phase = "draft";
    delete node.error;
    if (conflict) {
      node.phase = "review";
      node.error = "TRANSACTION_CONFLICT";
    }
    if (node.collateral && node.phase !== "retired") {
      const coin = await this.rpc("gettxout", [
        node.collateral.txid,
        node.collateral.vout,
        true,
      ]);
      node.collateralConfirmations = coin?.confirmations ?? null;
      if (coin)
        requirePolicy(
          rpcAmount(coin.value) === COLLATERAL_SATS &&
            coin.scriptPubKey.address === node.collateralAddress,
          "COLLATERAL_CHANGED",
          "Recorded collateral differs from the reserved wallet output.",
        );
      else if (collateral?.state === "confirmed" && !retirement) {
        node.phase = "review";
        node.error = "COLLATERAL_UNAVAILABLE";
      }
    }
    if (persist) this.staking.save(node);
    // Read-only status must show reconciled pending reviews too, without
    // mutating a recovered journal. This transient property is never persisted.
    Object.defineProperty(node, "observedRequests", {
      value: records,
      enumerable: false,
    });
    return node;
  }
  async reserve(node) {
    if (!node?.collateral || node.phase === "retired") return;
    const coin = await this.rpc("gettxout", [
      node.collateral.txid,
      node.collateral.vout,
      true,
    ]);
    if (coin) await this.coinLock([node.collateral]);
  }
  async reconcileLocks() {
    if (!this.supported()) return;
    return this.gate(async () => {
      const node = await this.refresh(this.staking.state(), { persist: true });
      await this.reserve(node);
      for (const record of this.staking.records())
        if (
          ["prepared", "signed", "broadcast_unknown"].includes(record.state)
        ) {
          const live = [];
          for (const point of record.outpoints || [])
            if (await this.rpc("gettxout", [point.txid, point.vout, true]))
              live.push(point);
          await this.coinLock(live);
        }
    });
  }
  async rewards(node) {
    let mature = 0n,
      immature = 0n;
    const seen = new Set();
    for (let skip = 0; skip < 10000; skip += 200) {
      const page = await this.rpc(
        "listtransactions",
        ["*", 200, skip, false],
        true,
      );
      requirePolicy(
        Array.isArray(page),
        "REWARDS_UNAVAILABLE",
        "Invalid wallet reward history.",
      );
      for (const entry of page) {
        if (
          entry.address !== node.payoutAddress ||
          !["generate", "immature"].includes(entry.category) ||
          entry.confirmations < 1
        )
          continue;
        const key = `${entry.txid}:${entry.vout}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (entry.category === "generate") mature += rpcAmount(entry.amount);
        else immature += rpcAmount(entry.amount);
      }
      if (page.length < 200)
        return {
          rewardsAmount: formatAmount(mature),
          immatureRewardsAmount: formatAmount(immature),
          rewardsComplete: true,
        };
    }
    return {
      rewardsAmount: null,
      immatureRewardsAmount: null,
      rewardsComplete: false,
    };
  }
  async status() {
    const base = {
      supported: this.supported(),
      currency: this.supported()
        ? "LAVE"
        : this.signer.identity.currency || "DASH",
      network: this.signer.identity,
      collateralAmount: COLLATERAL,
      availableAmount: null,
      lockedAmount: null,
      rewardsAmount: null,
      immatureRewardsAmount: null,
      observedAt: new Date(this.now()).toISOString(),
      canPrepare: false,
      prepareDisabledReason: "STAKING_UNSUPPORTED",
      recoveryLocked: !!recoveryState(this.store),
      localOnly: true,
      nodes: [],
      pendingReview: null,
    };
    if (!base.supported) return base;
    return this.gate(
      async () => {
        const coins = await this.available();
        base.availableAmount = formatAmount(
          coins.reduce((sum, coin) => sum + rpcAmount(coin.amount), 0n),
        );
        const node = await this.refresh(this.staking.state());
        base.lockedAmount =
          node?.collateral && node.phase !== "retired" ? COLLATERAL : "0";
        if (!node || node.phase === "retired") {
          base.canPrepare =
            !base.recoveryLocked &&
            coins.reduce((sum, coin) => sum + rpcAmount(coin.amount), 0n) >=
              COLLATERAL_SATS + MAX_FEE_SATS;
          base.prepareDisabledReason = base.canPrepare
            ? null
            : base.recoveryLocked
              ? "RECOVERY_LOCKED"
              : "INSUFFICIENT_FUNDS";
          if (!node) return base;
        }
        const live = await this.manager.inspect();
        const chain = await this.rpc("getblockchaininfo");
        const locks = await this.rpc("listlockunspent", [], true);
        const locked =
          !!node.collateral &&
          locks.some(
            (coin) => outpointKey(coin) === outpointKey(node.collateral),
          );
        let registered = false,
          registration = null;
        if (node.proTxHash && node.phase !== "retired")
          try {
            registration = await this.rpc("protx", ["info", node.proTxHash]);
            registered =
              registration.state?.pubKeyOperator === node.operator.public;
          } catch (error) {
            if (![-8, -5].includes(error.code)) throw error;
          }
        const current = node.observedRequests.find(
          (record) => !["confirmed", "cancelled"].includes(record.state),
        );
        if (current) base.pendingReview = this.review(current, node);
        if (node.phase !== "retired") {
          const privateFeeInput =
            node.phase === "collateral_ready"
              ? await this.registrationSource(coins)
              : null;
          base.canPrepare =
            !base.recoveryLocked &&
            !base.pendingReview &&
            (node.phase === "draft" || node.phase === "collateral_ready") &&
            (node.phase === "draft"
              ? coins.reduce((sum, coin) => sum + rpcAmount(coin.amount), 0n) >=
                COLLATERAL_SATS + MAX_FEE_SATS
              : !!privateFeeInput);
          base.prepareDisabledReason = base.canPrepare
            ? null
            : base.recoveryLocked
              ? "RECOVERY_LOCKED"
              : base.pendingReview
                ? "OPERATION_PENDING"
                : node.phase === "collateral_pending"
                  ? "COLLATERAL_PENDING"
                  : node.phase === "collateral_ready"
                    ? "INSUFFICIENT_PRIVATE_FEE_INPUT"
                    : "ALREADY_REGISTERED";
        }
        if (node.phase === "retired") {
          const retirement = await this.known(node.retirementTxid);
          const final =
            retirement?.confirmations >= 1 && retirement.chainlock === true;
          if (!final) {
            base.canPrepare = false;
            base.prepareDisabledReason = "RETIREMENT_FINALITY_PENDING";
          }
        }
        if (node.phase === "retired" && live.online) {
          base.canPrepare = false;
          base.prepareDisabledReason = "NODE_RUNNING";
        }
        const rewards = await this.rewards(node);
        Object.assign(base, rewards);
        base.nodes = [
          {
            id: node.id,
            name: node.name,
            state: node.phase,
            online: live.online,
            synchronized:
              live.online &&
              live.masternodeSynced === true &&
              live.peerCount > 0 &&
              live.bestblockhash === chain.bestblockhash,
            masternodeSynced: live.masternodeSynced === true,
            peerCount: live.peerCount ?? 0,
            registered,
            collateralLocked: locked,
            collateralAmount: COLLATERAL,
            collateralTxid: node.collateral?.txid || null,
            collateralVout: node.collateral?.vout ?? null,
            confirmations: node.collateralConfirmations ?? null,
            ...rewards,
            canRegister: node.phase === "collateral_ready" && base.canPrepare,
            payoutAddress: node.payoutAddress,
            service: node.service,
            proTxHash: node.proTxHash || null,
            masternodeState: live.masternodeState || null,
            canStart:
              !base.recoveryLocked &&
              registered &&
              locked &&
              !live.online &&
              !node.retirementTxid,
            canStop: !base.recoveryLocked && live.online,
            canRetire:
              !base.recoveryLocked &&
              !!node.collateral &&
              node.collateralConfirmations >= 1 &&
              !node.retirementTxid &&
              !base.pendingReview,
            error: node.error || null,
          },
        ];
        return base;
      },
      { mutation: false },
    );
  }
  async createNode(name) {
    const previous = this.staking.state();
    if (previous) {
      requirePolicy(
        previous.phase === "retired" && previous.retirementTxid,
        "EXISTING_COLLATERAL",
        "The previous masternode has not been retired.",
      );
      const retirement = await this.known(previous.retirementTxid);
      requirePolicy(
        retirement?.confirmations >= 1 && retirement.chainlock === true,
        "RETIREMENT_FINALITY_PENDING",
        "A confirmed ChainLock on the retirement spend is required before replacing this operator generation.",
      );
    }
    requirePolicy(
      typeof name === "string" &&
        name.trim().length >= 1 &&
        name.length <= 40 &&
        !/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
          name,
        ),
      "INVALID_NAME",
      "Choose a local masternode name of 1–40 plain characters.",
    );
    const coins = await this.available();
    requirePolicy(
      coins.reduce((sum, coin) => sum + rpcAmount(coin.amount), 0n) >=
        COLLATERAL_SATS + MAX_FEE_SATS,
      "INSUFFICIENT_FUNDS",
      "A local masternode requires 1000 confirmed spendable LAVE plus fees. No automatic funding is performed.",
    );
    const old = await this.manager.inspect();
    requirePolicy(
      !old.online,
      "NODE_RUNNING",
      "Stop the previous local node before preparing a replacement.",
    );
    const addresses = {};
    for (const key of [
      "collateralAddress",
      "ownerAddress",
      "votingAddress",
      "payoutAddress",
    ])
      addresses[key] = await this.rpc(
        "getnewaddress",
        [`wallet-masternode-${key}`],
        true,
      );
    const operator = await this.rpc("bls", ["generate"]);
    requirePolicy(
      /^[0-9a-f]{64}$/.test(operator.secret) &&
        /^[0-9a-f]{96}$/.test(operator.public),
      "INVALID_OPERATOR",
      "Core returned an invalid operator key.",
    );
    const node = {
      format: 1,
      generation: randomUUID(),
      role: this.role,
      id: this.config.id,
      name: name.trim(),
      network: IDENTITY,
      service: this.config.service,
      ...addresses,
      operator,
      phase: "draft",
      createdAt: new Date(this.now()).toISOString(),
    };
    this.staking.save(node);
    return node;
  }
  async prepare({ name } = {}) {
    return this.gate(async () => {
      let node = await this.refresh(this.staking.state(), { persist: true });
      await this.reserve(node);
      if (!node || node.phase === "retired")
        node = await this.createNode(name || `${this.role} local masternode`);
      const pending = this.staking.pending(node.generation);
      if (pending) {
        requirePolicy(
          ["prepared", "signed", "broadcast_unknown", "broadcast"].includes(
            pending.state,
          ),
          "OPERATION_UNCERTAIN",
          "An interrupted masternode operation requires inspection.",
        );
        return this.review(pending, node);
      }
      const kind = node.collateral ? "register" : "collateral";
      requirePolicy(
        kind === "collateral" ||
          (node.phase === "collateral_ready" &&
            node.collateralConfirmations >= 1),
        "COLLATERAL_PENDING",
        "Confirm the collateral transaction before preparing registration.",
      );
      return this.prepareRecord(node, kind);
    });
  }
  async prepareRecord(node, kind) {
    // Check a harmless funding failure before recording a potentially
    // reservation-changing operation. A later top-up can then retry normally.
    let registrationSource = null;
    if (kind === "collateral") {
      const amount = (await this.available()).reduce(
        (sum, coin) => sum + rpcAmount(coin.amount),
        0n,
      );
      requirePolicy(
        amount >= COLLATERAL_SATS + MAX_FEE_SATS,
        "INSUFFICIENT_FUNDS",
        "Collateral requires 1000 confirmed spendable LAVE plus fees.",
      );
    }
    if (kind === "register") {
      registrationSource = await this.registrationSource(
        await this.available(),
      );
      requirePolicy(
        registrationSource,
        "INSUFFICIENT_PRIVATE_FEE_INPUT",
        "Registration requires a separate confirmed internal-change fee input. Invoice receiving addresses are never used for registration change; no automatic funding is performed.",
      );
    }
    const record = {
      id: randomUUID(),
      generation: node.generation,
      role: this.role,
      nodeId: node.id,
      network: IDENTITY,
      service: node.service,
      kind,
      state: "preparing",
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + 30 * 60_000).toISOString(),
    };
    this.staking.put(record);
    try {
      let tx;
      if (kind === "register") {
        const source = registrationSource;
        record.changeAddress = source.address;
        const result = await this.rpc(
          "protx",
          [
            "register_prepare",
            node.collateral.txid,
            node.collateral.vout,
            [node.service],
            node.ownerAddress,
            node.operator.public,
            node.votingAddress,
            "0",
            node.payoutAddress,
            source.address,
          ],
          true,
        );
        requirePolicy(
          result.collateralAddress === node.collateralAddress &&
            typeof result.signMessage === "string",
          "REGISTRATION_CHANGED",
          "Prepared registration uses a different collateral key.",
        );
        record.unsignedHex = result.tx;
        record.signMessage = result.signMessage;
        tx = await this.rpc("decoderawtransaction", [result.tx]);
      } else {
        record.changeAddress = await this.rpc("getrawchangeaddress", [], true);
        if (kind === "retire")
          record.returnAddress = await this.rpc(
            "getnewaddress",
            ["retired-masternode-collateral"],
            true,
          );
        const result = await this.rpc(
          "walletcreatefundedpsbt",
          [
            kind === "retire" ? [node.collateral] : [],
            [
              {
                [kind === "retire"
                  ? record.returnAddress
                  : node.collateralAddress]: COLLATERAL,
              },
            ],
            0,
            {
              add_inputs: kind !== "retire",
              include_unsafe: false,
              includeWatching: false,
              changeAddress: record.changeAddress,
              lockUnspents: true,
              fee_rate: "1",
              subtractFeeFromOutputs: kind === "retire" ? [0] : [],
            },
            false,
          ],
          true,
        );
        record.psbt = result.psbt;
        const decoded = await this.rpc("decodepsbt", [result.psbt]);
        requirePolicy(
          decoded.inputs.every(
            (input) =>
              !input.final_scriptSig &&
              !Object.keys(input.partial_signatures || {}).length &&
              (!input.sighash || input.sighash === "ALL"),
          ),
          "PRE_SIGNED_PSBT",
          "Prepared staking PSBT must be unsigned with SIGHASH_ALL.",
        );
        tx = decoded.tx;
      }
      Object.assign(
        record,
        await inspectTransaction({ tx, record, node, rpc: this.rpc }),
      );
      if (kind === "collateral")
        record.collateralVout = tx.vout.find(
          (output) => output.scriptPubKey.address === node.collateralAddress,
        ).n;
      await this.coinLock(record.outpoints);
      record.fingerprint = reviewFingerprint(record);
      record.state = "prepared";
      this.staking.put(record);
      return this.review(record, node);
    } catch (error) {
      record.state = "preparation_uncertain";
      this.staking.put(record);
      throw error;
    }
  }
  required(requestId, fingerprint) {
    const node = this.staking.state(),
      record = this.staking.get(requestId);
    requirePolicy(
      node && record && record.generation === node.generation,
      "NOT_FOUND",
      "No current masternode request exists.",
    );
    requirePolicy(
      record.role === this.role &&
        canonical(record.network) === canonical(IDENTITY),
      "WRONG_NETWORK",
      "Stored masternode request identity differs.",
    );
    if (fingerprint !== undefined)
      requirePolicy(
        record.fingerprint === fingerprint &&
          reviewFingerprint(record) === fingerprint,
        "APPROVAL_MISMATCH",
        "Approval must match the saved masternode review fingerprint.",
      );
    return { node, record };
  }
  async approve({ requestId, fingerprint } = {}) {
    requirePolicy(
      typeof fingerprint === "string" && /^[0-9a-f]{64}$/.test(fingerprint),
      "APPROVAL_MISMATCH",
      "Approval requires the exact 64-character review fingerprint.",
    );
    return this.gate(() => this.approveRecord(requestId, fingerprint));
  }
  async approveRecord(id, fingerprint) {
    let { node, record } = this.required(id);
    requirePolicy(
      typeof fingerprint === "string" &&
        /^[0-9a-f]{64}$/.test(fingerprint) &&
        record.fingerprint === fingerprint &&
        reviewFingerprint(record) === fingerprint,
      "APPROVAL_MISMATCH",
      "Approval must match the saved masternode review fingerprint.",
    );
    node = await this.refresh(node, { persist: true });
    record = this.staking.get(id);
    requirePolicy(
      [
        "prepared",
        "signed",
        "broadcast_unknown",
        "broadcast",
        "confirmed",
      ].includes(record.state),
      "OPERATION_UNCERTAIN",
      "Masternode signing state needs manual inspection.",
    );
    if (record.state === "confirmed") {
      await this.reserve(node);
      return this.review(record, node);
    }
    if (!record.rawHex) {
      requirePolicy(
        Date.parse(record.expiresAt) > this.now(),
        "REQUEST_EXPIRED",
        "Masternode review expired; cancel the unsigned draft and prepare again.",
      );
      await this.reserve(node);
      const tx =
        record.kind === "register"
          ? await this.rpc("decoderawtransaction", [record.unsignedHex])
          : (await this.rpc("decodepsbt", [record.psbt])).tx;
      await inspectTransaction({ tx, record, node, rpc: this.rpc });
      record.state = "signing";
      this.staking.put(record);
      if (record.kind === "register") {
        const signature = await this.rpc(
          "signmessage",
          [node.collateralAddress, record.signMessage],
          true,
        );
        record.rawHex = await this.rpc(
          "protx",
          ["register_submit", record.unsignedHex, signature, false],
          true,
        );
      } else {
        const signed = await this.rpc(
          "walletprocesspsbt",
          [record.psbt, true, "ALL", true],
          true,
        );
        const final = await this.rpc("finalizepsbt", [signed.psbt, true]);
        requirePolicy(
          final.complete && typeof final.hex === "string",
          "INCOMPLETE_SIGNATURES",
          "Masternode PSBT could not be finalized.",
        );
        record.rawHex = final.hex;
      }
      const decoded = await this.rpc("decoderawtransaction", [record.rawHex]);
      await inspectTransaction({
        tx: decoded,
        record,
        node,
        rpc: this.rpc,
        signed: true,
      });
      record.txid = decoded.txid;
      record.state = "signed";
      this.staking.put(record);
    }
    // Reconstruct the durable node linkage even if the process stopped between
    // saving signed bytes and saving the corresponding node state.
    if (record.kind === "collateral") {
      node.collateral = { txid: record.txid, vout: record.collateralVout };
      node.phase = "collateral_pending";
    }
    if (record.kind === "register") {
      node.proTxHash = record.txid;
      node.phase = "registration_pending";
    }
    if (record.kind === "retire") {
      node.retirementTxid = record.txid;
      node.phase = "retire_pending";
    }
    this.staking.save(node);
    const decoded = await this.rpc("decoderawtransaction", [record.rawHex]);
    requirePolicy(
      decoded.txid === record.txid &&
        digest(stakingTemplate(decoded)) === record.templateHash,
      "TRANSACTION_CHANGED",
      "Saved masternode bytes no longer match their review.",
    );
    const known = await this.known(record.txid);
    if (
      known &&
      (known.confirmations >= 1 || (await this.inMempool(record.txid)))
    ) {
      record.state = "broadcast";
      this.staking.put(record);
      await this.reserve(node);
      return this.review(record, node);
    }
    const [acceptance] = await this.rpc("testmempoolaccept", [
      [record.rawHex],
      "0.0001",
    ]);
    requirePolicy(
      acceptance?.allowed,
      "MEMPOOL_REJECTED",
      "The approved masternode transaction is not accepted; its signed bytes remain saved.",
    );
    record.state = "broadcast_unknown";
    this.staking.put(record);
    try {
      const result = await this.rpc("sendrawtransaction", [
        record.rawHex,
        "0.0001",
      ]);
      requirePolicy(
        result === record.txid,
        "TRANSACTION_CHANGED",
        "Broadcast returned a different transaction identity.",
      );
      record.state = "broadcast";
      this.staking.put(record);
      await this.reserve(node);
      return this.review(record, node);
    } catch {
      throw new SignerError(
        "BROADCAST_UNCERTAIN",
        "The broadcast result is unknown. Retry only this saved request; no replacement transaction was created.",
      );
    }
  }
  async inMempool(txid) {
    try {
      await this.rpc("getmempoolentry", [txid]);
      return true;
    } catch (error) {
      if (error.code === -5) return false;
      throw error;
    }
  }
  async cancel({ requestId }) {
    return this.gate(async () => {
      const { node, record } = this.required(requestId);
      requirePolicy(
        record.state === "prepared" && !record.rawHex,
        "CANNOT_CANCEL",
        "Only an unsigned prepared masternode request can be cancelled.",
      );
      await this.coinLock(
        (record.outpoints || []).filter(
          (coin) =>
            !node.collateral ||
            outpointKey(coin) !== outpointKey(node.collateral),
        ),
        false,
      );
      record.state = "cancelled";
      this.staking.put(record);
      await this.reserve(node);
      return this.review(record, node);
    });
  }
  async start({ nodeId }) {
    return this.gate(async () => {
      const node = await this.refresh(this.staking.state(), { persist: true });
      requirePolicy(
        node?.id === nodeId &&
          node.phase === "registered" &&
          !node.retirementTxid,
        "REGISTRATION_PENDING",
        "Confirmed registration is required before starting.",
      );
      await this.reserve(node);
      const info = await this.rpc("protx", ["info", node.proTxHash]);
      requirePolicy(
        info.state?.pubKeyOperator === node.operator.public,
        "OPERATOR_MISMATCH",
        "Registered operator differs from this local node.",
      );
      const tip = await this.rpc("getblockchaininfo");
      await this.manager.start(node, {
        height: tip.blocks,
        hash: tip.bestblockhash,
      });
      return this.status();
    });
  }
  async stop({ nodeId }) {
    return this.gate(async () => {
      const node = this.staking.state();
      requirePolicy(
        node?.id === nodeId,
        "NOT_FOUND",
        "No local masternode exists for this role.",
      );
      await this.manager.stop(node);
      await this.reserve(node);
      return this.status();
    });
  }
  async retirePrepare({ nodeId }) {
    return this.gate(async () => {
      const node = await this.refresh(this.staking.state(), { persist: true });
      requirePolicy(
        node?.id === nodeId &&
          node.collateral &&
          node.collateralConfirmations >= 1 &&
          !node.retirementTxid,
        "CANNOT_RETIRE",
        "Confirmed unspent collateral is required for retirement.",
      );
      const pending = this.staking.pending(node.generation);
      if (pending) {
        requirePolicy(
          pending.kind === "retire" && pending.state === "prepared",
          "OPERATION_BUSY",
          "Finish or cancel the current operation first.",
        );
        return this.review(pending, node);
      }
      await this.reserve(node);
      return this.prepareRecord(node, "retire");
    });
  }
  async retireApprove(args = {}) {
    requirePolicy(
      typeof args.fingerprint === "string" &&
        /^[0-9a-f]{64}$/.test(args.fingerprint),
      "APPROVAL_MISMATCH",
      "Retirement requires the exact 64-character review fingerprint.",
    );
    const { record } = this.required(args.requestId);
    requirePolicy(
      record.kind === "retire",
      "WRONG_OPERATION",
      "This endpoint only approves collateral retirement.",
    );
    return this.approve(args);
  }
}
export function openStaking({ signer, store, ...options }) {
  return new StakingService({ signer, store, ...options });
}
