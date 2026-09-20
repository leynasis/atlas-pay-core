import { join } from "node:path";
import { SIGNER_DIR } from "../lab/config.mjs";
import { CustomerSigner } from "./service.mjs";
import { SignerStore } from "./store.mjs";
import { requirePolicy } from "./policy.mjs";

export async function labContext(role) {
  const config = await import("../lab/config.mjs");
  const lab = await import("../lab/rpc.mjs");
  const identity = config.NETWORK_IDENTITY;
  const rpc = (node, method, params = [], wallet) => {
    requirePolicy(
      node === role && (!wallet || wallet === role),
      "WRONG_ROLE",
      "This command cannot access another role or wallet.",
    );
    return lab.rpc(node, method, params, wallet);
  };
  const assertNode = (node) => {
    requirePolicy(
      node === role,
      "WRONG_ROLE",
      "This command cannot access another node.",
    );
    return lab.assertLabNode(node);
  };
  return { rpc, assertNode, identity };
}

export async function openRoleSigner(role = "customer") {
  requirePolicy(
    ["customer", "merchant"].includes(role),
    "WRONG_ROLE",
    "Unsupported signer role.",
  );
  const context = await labContext(role);
  const store = new SignerStore(join(SIGNER_DIR, `${role}.sqlite`));
  return { signer: new CustomerSigner({ ...context, store, role }), store };
}

export const openCustomerSigner = () => openRoleSigner("customer");
