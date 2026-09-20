import { join } from "node:path";
import { SIGNER_DIR } from "../lab/config.mjs";
import { CustomerSigner } from "./service.mjs";
import { SignerStore } from "./store.mjs";
import { protectSigner } from "../backup/gate.mjs";
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
    const physicalNode = config.ROLE_NODES[role];
    // The cashier exclusively allocates receiving-branch invoice addresses.
    // The private merchant wallet uses its independent change branch instead.
    if (
      config.PROFILE === "lave" &&
      role === "merchant" &&
      method === "getnewaddress"
    )
      return lab.rpc(
        physicalNode,
        "getrawchangeaddress",
        [],
        config.ROLE_WALLETS[role],
      );
    return lab.rpc(
      physicalNode,
      method,
      params,
      wallet ? config.ROLE_WALLETS[role] : undefined,
    );
  };
  const assertNode = async (node) => {
    requirePolicy(
      node === role,
      "WRONG_ROLE",
      "This command cannot access another node.",
    );
    const result = await lab.assertLabNode(config.ROLE_NODES[role]);
    if (config.PROFILE === "lave" && role === "merchant") {
      const { ensureSignerRange } = await import("./tracking.mjs");
      await ensureSignerRange();
    }
    return result;
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
  const signer = protectSigner(
    new CustomerSigner({ ...context, store, role }),
    store.path,
  );
  return { signer, store };
}

export const openCustomerSigner = () => openRoleSigner("customer");
