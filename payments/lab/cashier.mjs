import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { PROFILE, NODES, EXPECTED_CHAIN, NETWORK_IDENTITY } from "./config.mjs";
import { rpc, assertLabNode } from "./rpc.mjs";
import { canonical } from "../signer/policy.mjs";

const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function descriptorIdentity(items) {
  return hash(
    items
      .map(({ desc, internal = false, coinjoin = false }) => ({
        desc,
        internal,
        coinjoin,
      }))
      .sort((a, b) => a.desc.localeCompare(b.desc)),
  );
}
export function publicImports(descriptors, existing = []) {
  return descriptors.map((item) => {
    const prior = existing.find((value) => value.desc === item.desc);
    const result = {
      desc: item.desc,
      timestamp: 0,
      active: item.active === true,
      internal: item.internal === true,
    };
    if (item.range) {
      result.range = [
        Math.min(item.range[0], prior?.range?.[0] ?? item.range[0]),
        Math.max(item.range[1], prior?.range?.[1] ?? 0),
      ];
      result.next_index = Math.max(
        item.next_index ?? item.next ?? 0,
        prior?.next_index ?? prior?.next ?? 0,
      );
    }
    return result;
  });
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
async function loadWallet(node, wallet) {
  if ((await rpc(node, "listwallets")).includes(wallet)) return true;
  if (
    !(await rpc(node, "listwalletdir")).wallets.some(
      (item) => item.name === wallet,
    )
  )
    return false;
  await rpc(node, "loadwallet", [wallet, true]);
  return true;
}
async function descriptors(node, wallet) {
  return (await rpc(node, "listdescriptors", [false], wallet)).descriptors;
}
async function verifyPrivateSigner(expected) {
  const info = await rpc("signer", "getwalletinfo", [], "merchant");
  if (
    !info.descriptors ||
    info.private_keys_enabled !== true ||
    info.scanning !== false
  )
    throw new Error(
      "Merchant signer must be a ready private descriptor wallet.",
    );
  if (
    expected &&
    descriptorIdentity(await descriptors("signer", "merchant")) !== expected
  )
    throw new Error(
      "Merchant signer descriptors differ from the preserved source wallet.",
    );
}
async function verifyCashier(expected) {
  const info = await rpc("merchant", "getwalletinfo", [], "cashier");
  if (
    !info.descriptors ||
    info.private_keys_enabled !== false ||
    info.scanning !== false
  )
    throw new Error("Cashier must be a ready watch-only descriptor wallet.");
  if (descriptorIdentity(await descriptors("merchant", "cashier")) !== expected)
    throw new Error(
      "Cashier public descriptors differ from the merchant signer.",
    );
}

export async function ensureCashier() {
  if (PROFILE !== "lave") return;
  await assertLabNode("merchant");
  await assertLabNode("signer");
  const migration = join(NODES.signer.datadir, "migration", "v05");
  const journalPath = join(migration, "state.json");
  const backupPath = join(migration, "original-merchant.dat");
  const archivePath = join(migration, "original-merchant-wallet");
  await mkdir(migration, { recursive: true, mode: 0o700 });
  let journal;
  if (await exists(journalPath)) {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
    if (
      journal.format !== 1 ||
      canonical(journal.network) !== canonical(NETWORK_IDENTITY)
    )
      throw new Error(
        "Cashier migration journal belongs to another network or format.",
      );
  } else {
    journal = {
      format: 1,
      network: NETWORK_IDENTITY,
      state: "started",
      migratedExisting: (await rpc("merchant", "listwalletdir")).wallets.some(
        (item) => item.name === "merchant",
      ),
    };
    await save(journalPath, journal);
  }
  if (journal.state === "complete") {
    if (
      !(await loadWallet("signer", "merchant")) ||
      !(await loadWallet("merchant", "cashier"))
    )
      throw new Error(
        "Completed cashier migration is missing a wallet; restore its backup without creating replacement keys.",
      );
    await verifyPrivateSigner(journal.descriptorHash);
    await verifyCashier(journal.descriptorHash);
    if (
      (await rpc("merchant", "listwallets")).some((name) => name !== "cashier")
    )
      throw new Error(
        "Cashier node has an unexpected additional loaded wallet.",
      );
    return;
  }
  if (!journal.descriptors) {
    if (journal.migratedExisting) {
      if (!(await loadWallet("merchant", "merchant")))
        throw new Error(
          "Original merchant wallet is missing before migration backup.",
        );
      const original = await rpc("merchant", "getwalletinfo", [], "merchant");
      if (original.private_keys_enabled !== true || !original.descriptors)
        throw new Error(
          "Original merchant wallet must be a private descriptor wallet.",
        );
      journal.descriptors = await descriptors("merchant", "merchant");
      journal.addresses = [];
      for (const label of await rpc("merchant", "listlabels", [], "merchant")) {
        const entries = await rpc(
          "merchant",
          "getaddressesbylabel",
          [label],
          "merchant",
        );
        for (const [address, value] of Object.entries(entries))
          if (value.purpose === "receive")
            journal.addresses.push({ address, label });
      }
      journal.sourceBalance = await rpc(
        "merchant",
        "getbalance",
        ["*", 0, false, true],
        "merchant",
      );
      journal.sourceTxCount = original.txcount;
    } else {
      if (!(await loadWallet("signer", "merchant")))
        await rpc("signer", "createwallet", [
          "merchant",
          false,
          false,
          null,
          false,
          true,
          true,
        ]);
      journal.descriptors = await descriptors("signer", "merchant");
      journal.addresses = [];
    }
    for (const item of journal.descriptors) {
      const parsed = await rpc(
        journal.migratedExisting ? "merchant" : "signer",
        "getdescriptorinfo",
        [item.desc],
      );
      if (parsed.hasprivatekeys !== false || Object.hasOwn(item, "mnemonic"))
        throw new Error("Migration accepts only public descriptor exports.");
    }
    journal.descriptorHash = descriptorIdentity(journal.descriptors);
    journal.state = "source-recorded";
    await save(journalPath, journal);
  }
  if (journal.migratedExisting && !(await exists(backupPath))) {
    if (!(await loadWallet("merchant", "merchant")))
      throw new Error("Original merchant wallet is unavailable for backup.");
    await rpc("merchant", "backupwallet", [backupPath], "merchant");
    await chmod(backupPath, 0o600);
  }
  if (!(await loadWallet("signer", "merchant"))) {
    if (!journal.migratedExisting)
      throw new Error("Fresh signer wallet disappeared during migration.");
    await rpc("signer", "restorewallet", ["merchant", backupPath, true]);
  }
  await verifyPrivateSigner(journal.descriptorHash);
  if (!(await loadWallet("merchant", "cashier")))
    await rpc("merchant", "createwallet", [
      "cashier",
      true,
      true,
      null,
      false,
      true,
      true,
    ]);
  const cashierInfo = await rpc("merchant", "getwalletinfo", [], "cashier");
  if (cashierInfo.private_keys_enabled !== false)
    throw new Error(
      "Existing cashier wallet unexpectedly contains private keys.",
    );
  const prior = await descriptors("merchant", "cashier");
  if (prior.length && descriptorIdentity(prior) !== journal.descriptorHash)
    throw new Error(
      "Existing cashier wallet has unrelated descriptors; refusing to overwrite it.",
    );
  const imported = await rpc(
    "merchant",
    "importdescriptors",
    [publicImports(journal.descriptors, prior)],
    "cashier",
    { timeout: 120000 },
  );
  if (
    imported.length !== journal.descriptors.length ||
    imported.some((item) => item.success !== true)
  )
    throw new Error(
      "Cashier public descriptor import failed; original wallets and migration backup are preserved.",
    );
  for (const { address, label } of journal.addresses)
    await rpc("merchant", "setlabel", [address, label], "cashier");
  await verifyCashier(journal.descriptorHash);
  for (const { address } of journal.addresses) {
    const watching = await rpc(
      "merchant",
      "getaddressinfo",
      [address],
      "cashier",
    );
    const owning = await rpc("signer", "getaddressinfo", [address], "merchant");
    if (!(watching.ismine || watching.iswatchonly) || !owning.ismine)
      throw new Error(
        "A historical merchant address was not preserved by migration.",
      );
  }
  if (journal.migratedExisting) {
    const cashierBalance = await rpc(
      "merchant",
      "getbalance",
      ["*", 0, false, true],
      "cashier",
    );
    const signerBalance = await rpc(
      "signer",
      "getbalance",
      ["*", 0, false, true],
      "merchant",
    );
    if (cashierBalance !== signerBalance)
      throw new Error(
        "Cashier and signer balances disagree after migration rescan.",
      );
    if ((await rpc("merchant", "listwallets")).includes("merchant"))
      await rpc("merchant", "unloadwallet", ["merchant", false]);
    const candidates = [
      join(NODES.merchant.datadir, EXPECTED_CHAIN, "wallets", "merchant"),
      join(NODES.merchant.datadir, EXPECTED_CHAIN, "merchant"),
    ];
    for (const source of candidates) {
      if (!(await exists(source))) continue;
      if (await exists(archivePath))
        throw new Error(
          "Both source and archive exist; refusing to overwrite either original wallet.",
        );
      await rename(source, archivePath);
    }
    if (!(await exists(archivePath)))
      throw new Error("Original merchant wallet archive is missing.");
  }
  journal.state = "complete";
  journal.completedAt = new Date().toISOString();
  await save(journalPath, journal);
}
