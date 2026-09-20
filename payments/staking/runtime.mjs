import { recoveryState } from "../backup/gate.mjs";
import { StakingService } from "./service.mjs";
export function openStaking({ signer, store, ...options }) {
  return new StakingService({ signer, store, ...options });
}
// Called before ordinary payment preparation, including the CLI. Native wallet
// locks persist too; the journal also restores a lock for a newly broadcast
// collateral output after an interrupted response or process restart.
export async function reapplyStakingLocks(signer, store) {
  const service = new StakingService({ signer, store });
  if (service.supported() && !recoveryState(store))
    await service.reconcileLocks();
}
