import { openRoleSigner } from "../signer/runtime.mjs";
import { protectWallet } from "../backup/gate.mjs";
import { WalletService } from "./service.mjs";
export async function openWallet(role) {
  const { signer, store } = await openRoleSigner(role);
  return {
    service: protectWallet(
      new WalletService({ signer, store, role }),
      store.path,
    ),
    store,
  };
}
