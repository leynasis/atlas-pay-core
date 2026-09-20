import { fileURLToPath } from "node:url";
import { CustomerSigner } from "./service.mjs";
import { SignerStore } from "./store.mjs";
import { requirePolicy } from "./policy.mjs";

export async function labContext(role) {
  const config = await import("../lab/config.mjs");
  const lab = await import("../lab/rpc.mjs");
  const identity = {
    chain: config.EXPECTED_CHAIN,
    devnetName: config.LAB_NAME,
    genesisHash: config.GENESIS_HASH,
    devnetGenesisHash: config.DEVNET_GENESIS_HASH,
  };
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
  const store = new SignerStore(
    fileURLToPath(
      new URL(`../.runtime/signer/${role}.sqlite`, import.meta.url),
    ),
  );
  return { signer: new CustomerSigner({ ...context, store, role }), store };
}

export const openCustomerSigner = () => openRoleSigner("customer");
