import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { readSession, ADMIN_SESSION_COOKIE, BPO_SESSION_COOKIE, AGENT_SESSION_COOKIE } from "@/lib/session";

async function account() {
  const jar = await cookies();
  for (const name of [BPO_SESSION_COOKIE, ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE]) {
    const session = await readSession(jar.get(name)?.value);
    if (session) return session.agentId;
  }
  return null;
}
async function preferences() {
  const client = await db();
  await client.query(`CREATE TABLE IF NOT EXISTS user_currency_preferences (agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, currency VARCHAR(3) NOT NULL CHECK(currency IN ('PKR','USD')))`);
  return client;
}
export async function GET() {
  let currency: "PKR" | "USD" | null = null;
  try {
    const id = await account();
    if (id) { const result = await (await preferences()).query("SELECT currency FROM user_currency_preferences WHERE agent_id=$1", [id]); currency = result.rows[0]?.currency ?? null; }
  } catch { /* Browser preference remains available if storage is temporarily offline. */ }
  let usdToPkr: number | null = null, updatedAt: string | null = null;
  const configured = Number(process.env.EXCHANGE_RATE_USD_PKR);
  if (Number.isFinite(configured) && configured > 0) usdToPkr = configured;
  else for (const endpoint of ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", "https://latest.currency-api.pages.dev/v1/currencies/usd.json"]) {
    try {
      const response = await fetch(endpoint, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      const rate = Number(data.usd?.pkr);
      if (response.ok && rate > 0 && Number.isFinite(rate)) { usdToPkr = rate; updatedAt = data.date; break; }
    } catch { /* Try the fallback; never invent a conversion rate. */ }
  }
  return Response.json({ currency, baseCurrency: "PKR", usdToPkr, updatedAt, source: null }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(request: Request) {
  try {
    const id = await account();
    if (!id) return Response.json({ message: "Sign in to save your currency preference." }, { status: 401 });
    const { currency } = await request.json();
    if (currency !== "PKR" && currency !== "USD") return Response.json({ message: "Choose PKR or USD." }, { status: 400 });
    await (await preferences()).query("INSERT INTO user_currency_preferences(agent_id,currency) VALUES($1,$2) ON CONFLICT(agent_id) DO UPDATE SET currency=EXCLUDED.currency", [id, currency]);
    return Response.json({ currency });
  } catch { return Response.json({ message: "Could not save your currency preference." }, { status: 503 }); }
}
