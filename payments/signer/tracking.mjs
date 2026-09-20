import { join } from "node:path";
import { SIGNER_DIR } from "../lab/config.mjs";
import { withWalletGate } from "../backup/gate.mjs";
import { merchantReadRpc, rpc, assertLabNode } from "../lab/rpc.mjs";
import { descriptorIdentity } from "../lab/cashier.mjs";

let pending;
export async function ensureSignerRange() {
  if (pending) return pending;
  pending = withWalletGate(
    join(SIGNER_DIR, "merchant.sqlite"),
    synchronize,
  ).finally(() => {
    pending = null;
  });
  return pending;
}
async function synchronize() {
  const publicSet = (await merchantReadRpc("listdescriptors", [false]))
    .descriptors;
  const privateSet = (
    await rpc("signer", "listdescriptors", [false], "merchant")
  ).descriptors;
  if (descriptorIdentity(publicSet) !== descriptorIdentity(privateSet))
    throw new Error("Cashier and merchant signer descriptors do not match.");
  let needed = 0;
  for (const external of publicSet.filter(
    (item) => item.active && !item.internal && item.range,
  )) {
    const own = privateSet.find((item) => item.desc === external.desc);
    if (external.range[1] > own.range[1])
      needed = Math.max(needed, external.range[1] + 1001);
  }
  if (!needed) return;
  if (!Number.isSafeInteger(needed) || needed > 100000)
    throw new Error(
      "Cashier descriptor range exceeds the supported local limit; inspect wallet tracking before signing.",
    );
  await assertLabNode("signer");
  await rpc("signer", "keypoolrefill", [needed], "merchant");
  await rpc("signer", "rescanblockchain", [0], "merchant", { timeout: 120000 });
}
