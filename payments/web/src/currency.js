// Currency comes from backend/request metadata. A brand name alone is never
// evidence that existing coins changed denomination.
export function currencyFor(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const currency = source.currency || source.network?.currency;
    if (currency === "LAVE" || currency === "DASH") return currency;
    const chain =
      typeof source.network === "string"
        ? source.network
        : source.network?.chain || source.chain;
    if (chain === "regtest" || chain === "devnet-atlas-local-v1") return "DASH";
  }
  return "—";
}
export function profileFor(source) {
  if (source?.profile === "lave" || source?.profile === "atlas")
    return source.profile;
  const chain =
    typeof source?.network === "string"
      ? source.network
      : source?.network?.chain || source?.chain;
  if (chain === "devnet-atlas-local-v1") return "atlas";
  if (chain === "regtest") return "regtest";
  return source?.network?.currency === "LAVE" ? "lave" : null;
}
export function networkFor(source) {
  return (
    source?.network?.devnetName ||
    source?.devnetName ||
    source?.name ||
    (typeof source?.network === "string"
      ? source.network
      : source?.network?.chain) ||
    source?.chain ||
    "—"
  );
}
export function walletStorageKey(status) {
  const chain = status?.network?.chain;
  const genesis = status?.network?.genesisHash;
  return chain && genesis
    ? `lavepay-wallet-active-v2:${chain}:${genesis}`
    : null;
}
