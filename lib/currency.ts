export type DisplayCurrency = "PKR" | "USD";
// All stored prices and balances are denominated in PKR. Conversion is display-only.
export function formatCurrency(value: number | string, currency: DisplayCurrency, usdToPkr?: number | null) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "—";
  if (currency === "USD" && (!usdToPkr || !Number.isFinite(usdToPkr) || usdToPkr <= 0)) return "—";
  const converted = currency === "USD" ? amount / usdToPkr! : amount;
  return `${currency === "USD" ? "$" : "PKR "}${converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
