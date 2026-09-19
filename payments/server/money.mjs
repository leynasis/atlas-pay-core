export const COIN = 100_000_000n;
export const MAX_MONEY = 21_000_000n * COIN;

// Amounts enter and leave this application as decimal strings. No floating-point arithmetic.
export function parseAmount(value, { allowZero = false } = {}) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,7})(?:\.\d{1,8})?$/.test(value)
  ) {
    throw new Error(
      "Amount must be a decimal string with at most 8 decimal places.",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const sats = BigInt(whole) * COIN + BigInt(fraction.padEnd(8, "0"));
  if (sats < (allowZero ? 0n : 1n) || sats > MAX_MONEY)
    throw new Error("Amount is outside the supported DASH range.");
  return sats;
}

export function formatAmount(sats) {
  sats = BigInt(sats);
  const sign = sats < 0n ? "-" : "";
  if (sats < 0n) sats = -sats;
  const fraction = (sats % COIN).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${sats / COIN}${fraction ? `.${fraction}` : ""}`;
}

export function rpcAmount(value) {
  // JSON RPC integer values (e.g. zero) are also exact. Decimal JSON tokens are
  // preserved as strings by parseRpcJson before JSON.parse can round them.
  if (typeof value === "number" && Number.isSafeInteger(value))
    value = String(value);
  return parseAmount(value, { allowZero: true });
}
