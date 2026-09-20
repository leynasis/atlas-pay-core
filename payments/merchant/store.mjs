import { InvoiceStore } from "../server/store.mjs";

// A separate database keeps the named-devnet merchant ledger independent of
// the legacy regtest demonstration. Its inherited journal uses FULL durability.
export class MerchantStore extends InvoiceStore {}
