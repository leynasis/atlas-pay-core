import { openRoleSigner } from "../signer/runtime.mjs";
import { protectWallet } from "../backup/gate.mjs";
import { WalletService } from "./service.mjs";
import { openStaking } from "../staking/runtime.mjs";
export async function openWallet(role) {
  const { signer, store } = await openRoleSigner(role);
  return {
    staking: await openStaking({ signer, store }),
    service: protectWallet(
      new WalletService({ signer, store, role }),
      store.path,
    ),
    store,
  };
}
