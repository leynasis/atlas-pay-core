// Explicit operator-only test funding. This module is never imported by a web API.
import { createHash } from "node:crypto";
import { loadState, saveState } from "./state.mjs";
import { rpc, assertNode } from "./rpc.mjs";
import { preparePayment, broadcastPrepared } from "./lifecycle.mjs";
export async function fundOwnedWallets(addresses) {
  const state = await loadState();
  state.testFunding ||= {};
  const result = {};
  for (const role of ["customer", "merchant"]) {
    const address = addresses[role],
      node = role === "customer" ? "customer" : "signer";
    if (typeof address !== "string")
      throw new Error("Explicit owned test funding addresses are required");
    await assertNode(node);
    const ownership = await rpc(node, "getaddressinfo", [address], role);
    if (ownership.ismine !== true || ownership.iswatchonly === true)
      throw new Error(
        `The private ${role} wallet does not own the test funding address`,
      );
    const key = createHash("sha256")
      .update(`${role}:${address}:1002.00000000`)
      .digest("hex");
    if (!state.testFunding[key]) {
      state.testFunding[key] = {
        role,
        address,
        amount: "1002.00000000",
        ...(await preparePayment([{ [address]: "1002.00000000" }])),
      };
      await saveState(state);
    }
    await broadcastPrepared(state.testFunding[key]);
    result[role] = {
      address,
      amount: "1002.00000000",
      txid: state.testFunding[key].txid,
    };
  }
  return result;
}
