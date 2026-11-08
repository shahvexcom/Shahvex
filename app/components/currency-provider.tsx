"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { formatCurrency, type DisplayCurrency } from "@/lib/currency";
import { CustomDropdown } from "./custom-dropdown";

type CurrencyContextValue = { currency: DisplayCurrency; formatMoney: (value: number | string) => string; setCurrency: (value: DisplayCurrency) => void; usdToPkr: number | null; message: string; source: string | null };
const CurrencyContext = createContext<CurrencyContextValue>({ currency: "USD", formatMoney: value => formatCurrency(value, "USD"), setCurrency: () => {}, usdToPkr: null, message: "", source: null });
export const useCurrency = () => useContext(CurrencyContext);
export function CurrencyProvider({ children, initialCurrency = "USD" }: { children: ReactNode; initialCurrency?: DisplayCurrency }) {
  const [currency, setValue] = useState<DisplayCurrency>(initialCurrency);
  const [usdToPkr, setRate] = useState<number | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    // Hydrate the browser-only preference after SSR without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = localStorage.getItem("shahvex-currency"); if (saved === "USD" || saved === "PKR") setValue(saved); } catch {}
    fetch("/api/currency").then(r => r.json()).then(data => {
      if (!active) return;
      if (data.usdToPkr > 0) setRate(data.usdToPkr);
      setSource(data.source || null);
      if (data.currency === "PKR" || data.currency === "USD") { setValue(data.currency); document.cookie = `shahvex-currency=${data.currency}; Path=/; Max-Age=31536000; SameSite=Lax`; try { localStorage.setItem("shahvex-currency", data.currency); } catch {} }
      if (!data.usdToPkr) setMessage("USD conversion is temporarily unavailable. PKR amounts remain available.");
    }).catch(() => { if (active) setMessage("Currency conversion is temporarily unavailable."); });
    return () => { active = false; };
  }, []);
  const setCurrency = async (next: DisplayCurrency) => {
    if (saving || (next === "USD" && !usdToPkr)) return;
    setValue(next); setMessage(""); setSaving(true);
    document.cookie = `shahvex-currency=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { localStorage.setItem("shahvex-currency", next); } catch {}
    try {
      const response = await fetch("/api/currency", { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency: next }) });
      if (!response.ok) setMessage("Currency changed for this browser. Account preference could not be saved; select it again to retry.");
    } catch { setMessage("Currency changed for this browser. Account preference could not be saved; select it again to retry."); }
    finally { setSaving(false); }
  };
  return <CurrencyContext.Provider value={{ currency, setCurrency, usdToPkr, source, message, formatMoney: value => formatCurrency(value, currency, usdToPkr) }}>{children}</CurrencyContext.Provider>;
}
export function CurrencySelector() {
  const { currency, setCurrency, usdToPkr, message } = useCurrency();
  return <div className="currency-selector" data-tooltip={message || "Choose your display currency"}><CustomDropdown value={currency} onChange={value => setCurrency(value as DisplayCurrency)} ariaLabel="Display currency" options={[{ value: "PKR", label: "PKR" }, { value: "USD", label: "USD ($)", disabled: !usdToPkr }]} /></div>;
}
