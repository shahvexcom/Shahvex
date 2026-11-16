import { z } from "zod";
import { createHmac } from "node:crypto";
import { db } from "./database";
import { principal } from "./voip-controller";
import { encryptCredential, decryptCredential } from "./credential-crypto";
import { defaultInitialScript } from "./agent-script-details";
import { isLocalTestVoice } from "../gateway/local-test-voices.cjs";
import { savedVoiceCatalog } from "./local-voice-registry";

export function localBridgeURL(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw Error("Use a localhost HTTP origin, for example http://127.0.0.1:8792");
  // Pin localhost to loopback; no DNS lookup or redirect may change the target.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}
async function localRequest(base: string, secret: string, agent?: object) {
  const origin = localBridgeURL(base), path = "/local-monitor", method = agent ? "POST" : "GET";
  const body = agent ? JSON.stringify({ agent }) : "", stamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${stamp}\n${method}\n${path}\n${body}`).digest("hex");
  const response = await fetch(`${origin}${path}`, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", "x-shahvex-timestamp": stamp, "x-shahvex-signature": signature }, ...(agent ? { body } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 401 ? "Bridge secret is incorrect." : data.error || "Update and restart the local manual bridge to enable the monitor.");
  if (data.testOnly !== true || !Array.isArray(data.calls)) throw Error("This is not a local test bridge.");
  return data;
}
const form = z.object({ url: z.string().max(300), secret: z.string().min(32).max(2000).optional(),
  name: z.string().trim().min(1).max(80), voice: z.string().refine(isLocalTestVoice, "Select Lissa, Emma or Olivia"), first: z.enum(["ai", "customer"]) }).strict();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function localMonitorConnection(portal: "admin" | "bpo", request?: Request) {
  const owner = await principal(portal);
  if (!owner) return json({ error: "Local connection access is not authorized." }, 403);
  if (request && request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Same-origin request required." }, 403);
  const client = await db();
  const row = (await client.query("SELECT initial_script,local_url,local_secret_ciphertext FROM live_monitor_settings WHERE owner_id=$1", [owner])).rows[0];
  try {
    if (request) {
      const parsed = form.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "Enter the localhost URL, bridge secret, agent name and select Lissa, Emma or Olivia." }, 400);
      const v = parsed.data, url = localBridgeURL(v.url);
      if (!(await savedVoiceCatalog(owner)).voices.some(voice => voice.id === v.voice))
        return json({ error: "This voice is not approved for your account." }, 403);
      const secret = v.secret || (row?.local_secret_ciphertext ? decryptCredential(row.local_secret_ciphertext) : "");
      if (!secret) return json({ error: "Enter your local bridge shared secret." }, 400);
      const script = row?.initial_script || defaultInitialScript;
      const data = await localRequest(url, secret, { name: v.name, voice: v.voice, first: v.first, script });
      await client.query(`INSERT INTO live_monitor_settings(owner_id,initial_script,local_url,local_secret_ciphertext) VALUES($1,$2,$3,$4)
        ON CONFLICT(owner_id) DO UPDATE SET local_url=EXCLUDED.local_url,local_secret_ciphertext=EXCLUDED.local_secret_ciphertext,updated_at=NOW()`, [owner, script, url, encryptCredential(secret)]);
      return json({ ...data, connected: true, url, message: "Voice and script applied to the next incoming test call. Dial your configured Asterisk extension to start a call." });
    }
    if (!row?.local_url || !row.local_secret_ciphertext) return json({ connected: false, calls: [] });
    return json({ ...await localRequest(row.local_url, decryptCredential(row.local_secret_ciphertext)), connected: true, url: row.local_url });
  } catch (error) {
    return json({ connected: false, calls: [], error: error instanceof Error && !/fetch failed/i.test(error.message) ? error.message : "Cannot reach the local bridge. Check that it is running on this website's machine." }, 502);
  }
}
