import { openRoleSigner } from "../signer/runtime.mjs";
import { WalletService } from "./service.mjs";
export async function openWallet(role) {
  const { signer, store } = await openRoleSigner(role);
  return { service: new WalletService({ signer, store, role }), store };
}
