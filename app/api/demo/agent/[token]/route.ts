import { timingSafeEqual } from "node:crypto";
import { demoDb, demoHeaders, demoJson, demoLink, demoRate } from "@/lib/agent-demo";
import { newTest, sessions, localVoices, warmSelectedVoice, pruneSessions } from "@/lib/agent-test";
import { extractAgentScript } from "@/lib/agent-script-extraction";
import { handleTestSession } from "@/lib/agent-test-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ token: string }> };

// Only the website backend knows these Cloudflare Access and bridge credentials.
async function bridge(request: Request): Promise<Response | null> {
  if (process.env.VERCEL && !process.env.SHAHVEX_DEMO_BACKEND_URL) return demoJson({ error: "Demo backend is not connected" }, 503);
  if (!process.env.SHAHVEX_DEMO_BACKEND_URL) {
    const key = process.env.SHAHVEX_DEMO_BRIDGE_SECRET;
    if (key) {
      const got = Buffer.from(request.headers.get("x-shahvex-demo-key") || ""), expected = Buffer.from(key);
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return demoJson({ error: "Unauthorized bridge" }, 401);
    }
    return null;
  }
  const target = new URL(process.env.SHAHVEX_DEMO_BACKEND_URL);
  if (target.protocol !== "https:" || target.username || target.password || !process.env.SHAHVEX_DEMO_BRIDGE_SECRET || !process.env.SHAHVEX_CF_ACCESS_CLIENT_ID || !process.env.SHAHVEX_CF_ACCESS_CLIENT_SECRET) return demoJson({ error: "Secure demo bridge is not configured" }, 503);
  const from = new URL(request.url); target.pathname = from.pathname; target.search = from.search;
  const headers = new Headers({ origin: target.origin, "x-shahvex-demo-key": process.env.SHAHVEX_DEMO_BRIDGE_SECRET,
    "CF-Access-Client-Id": process.env.SHAHVEX_CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.SHAHVEX_CF_ACCESS_CLIENT_SECRET });
  if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!);
  // Bound input below the Vercel function payload ceiling; stream output without buffering.
  const body = request.method === "POST" ? await boundedBody(request, 2_000_000) : undefined;
  const response = await fetch(target, { method: request.method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(240_000)]) });
  return new Response(response.body, { status: response.status, headers: { ...demoHeaders, "Content-Type": response.headers.get("content-type") || "application/json", "X-Accel-Buffering": "no" } });
}
async function boundedBody(request: Request, max: number) {
  const chunks: Uint8Array[] = []; let size = 0;
  if (request.body) for await (const part of request.body as unknown as AsyncIterable<Uint8Array>) { size += part.length; if (size > max) throw Error("BODY_LIMIT"); chunks.push(part); }
  return Buffer.concat(chunks);
}
export async function GET(request: Request, context: Context) {
  try {
    const forwarded = await bridge(request); if (forwarded) return forwarded;
    const link = await demoLink((await context.params).token);
    if (!link) return demoJson({ error: "This test link is invalid or expired" }, 404);
    if (!(await demoRate((await context.params).token))) return demoJson({ error: "Too many requests" }, 429);
    // No voice inventory, script, extracted knowledge, owner or credentials leave the server.
    return demoJson({ agent: { name: link.name, avatarUrl: link.avatar_url || "" }, config: { name: link.name, first: link.speaks_first || "customer", voice: "assigned", script: "", goal: "", task: "", instructions: "", knowledge: "", style: "" }, voices: [{ id: "assigned", name: "Assigned voice" }] });
  } catch { return demoJson({ error: "Test service unavailable" }, 503); }
}
export async function POST(request: Request, context: Context) {
  request = new Request(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]) });
  let allocated = "";
  try {
    // Browser entrypoints enforce Origin. The isolated tunnel backend authenticates
    // the service key instead: TLS terminates at Cloudflare, not loopback Next.
    const browserEntry = Boolean(process.env.SHAHVEX_DEMO_BACKEND_URL || process.env.VERCEL) || !process.env.SHAHVEX_DEMO_BRIDGE_SECRET;
    if (browserEntry && request.headers.get("origin") !== new URL(request.url).origin) return demoJson({ error: "Same-origin request required" }, 403);
    const forwarded = await bridge(request); if (forwarded) return forwarded;
    const link = await demoLink((await context.params).token);
    if (!link) return demoJson({ error: "This test link is invalid or expired" }, 404);
    if (!(await demoRate((await context.params).token))) return demoJson({ error: "Too many requests" }, 429);
    const url = new URL(request.url), action = url.searchParams.get("action"), id = url.searchParams.get("id") || "";
    const pool = await demoDb(); pruneSessions();
    if (action === "start") {
      const body = JSON.parse((await boundedBody(request, 4096)).toString());
      if (body.consent !== true) return demoJson({ error: "Microphone and recording consent is required" }, 400);
      const client = await pool.connect(); let sid = "";
      try {
        await client.query("BEGIN");
        // Shared transaction lock prevents admission races across application instances.
        await client.query("SELECT pg_advisory_xact_lock(1936220536)");
        const current = await client.query("SELECT * FROM agent_demo_links WHERE id=$1 FOR UPDATE", [link.id]);
        const l = current.rows[0];
        if (!l || l.revoked_at || new Date(l.expires_at).getTime() <= Date.now() || l.used_sessions >= l.max_sessions) { await client.query("ROLLBACK"); return demoJson({ error: "Test link usage is exhausted or expired" }, 410); }
        const count = await client.query("SELECT COUNT(*)::int n FROM agent_demo_sessions WHERE ended_at IS NULL AND expires_at>NOW()");
        const cap = Math.max(1, Math.min(10, Number(process.env.SHAHVEX_DEMO_MAX_CONCURRENT) || 1));
        if (count.rows[0].n >= cap) { await client.query("ROLLBACK"); return demoJson({ error: "All demo sessions are busy. Try again later." }, 429); }
        sid = newTest(`demo:${crypto.randomUUID()}`, link.agent_id, { name: link.name, voice: link.local_voice_id || "", first: link.speaks_first || "customer", script: link.script, goal: "", task: "", instructions: `Language: ${link.language || "English"}. Accent: ${link.accent || "default"}.`, knowledge: "", style: link.conversation_style || "Professional" });
        // Fixed lifetime; abandoning a tab cannot hold capacity indefinitely.
        await client.query("INSERT INTO agent_demo_sessions(id,link_id,expires_at,consent_version) VALUES($1,$2,LEAST($3::timestamptz,NOW()+INTERVAL '15 minutes'),'mic-recording-v1')", [sid,link.id,link.expires_at]);
        await client.query("UPDATE agent_demo_links SET used_sessions=used_sessions+1 WHERE id=$1", [link.id]);
        await client.query("COMMIT"); allocated = sid;
      } catch (error) { await client.query("ROLLBACK"); if (sid) sessions.delete(sid); throw error; } finally { client.release(); }
      const s = sessions.get(sid)!;
      const startup = new AbortController(); s.abort = startup;
      const startupSignal = AbortSignal.any([request.signal, startup.signal]);
      // Stop stale inference and release memory even if the visitor abandons the tab.
      const watchdog = setInterval(() => {
        void pool.query(`SELECT s.id FROM agent_demo_sessions s JOIN agent_demo_links l ON l.id=s.link_id
          WHERE s.id=$1 AND s.ended_at IS NULL AND s.expires_at>NOW() AND l.expires_at>NOW() AND l.revoked_at IS NULL`, [sid]).then(result => {
          if (!result.rowCount || !sessions.has(sid)) {
            clearInterval(watchdog); s.abort?.abort(); sessions.delete(sid);
          }
        }).catch(() => { clearInterval(watchdog); s.abort?.abort(); sessions.delete(sid); });
      }, 2000); watchdog.unref();
      if (!(await localVoices(link.owner_id)).voices.some(v => v.id === s.config.voice)) throw Error("Saved voice unavailable");
      await warmSelectedVoice(s.config.voice, startupSignal);
      const details = await extractAgentScript(link.owner_id, link.script, startupSignal);
      startupSignal.throwIfAborted();
      s.config.goal = details.goals.join("\n"); s.config.task = details.tasks.join("\n");
      s.messages[0].content += `\nSaved goals: ${s.config.goal}\nSaved tasks: ${s.config.task}\nSaved instructions: ${[...details.instructions,...details.conversationFlow,...details.restrictions].join("\n")}\nSaved knowledge: ${[...details.knowledge,...details.faqs].join("\n")}`;
      return demoJson({ id: sid });
    }
    if (!["turn", "interrupt", "stop"].includes(action || "")) return demoJson({ error: "Unknown action" }, 400);
    const lease = await pool.query(`UPDATE agent_demo_sessions SET
      request_count=CASE WHEN request_window<NOW()-INTERVAL '1 minute' THEN 1 ELSE request_count+1 END,
      request_window=CASE WHEN request_window<NOW()-INTERVAL '1 minute' THEN NOW() ELSE request_window END
      WHERE id=$1 AND link_id=$2 AND ended_at IS NULL AND expires_at>NOW()
      AND ($3='stop' OR request_count<90 OR request_window<NOW()-INTERVAL '1 minute') RETURNING id`, [id,link.id,action]);
    if (!lease.rowCount) return demoJson({ error: "Session expired or request limit reached" }, 429);
    const s = sessions.get(id); if (!s || s.agentId !== link.agent_id) { await pool.query("UPDATE agent_demo_sessions SET ended_at=NOW() WHERE id=$1", [id]); return demoJson({ error: "Session ended. Start again." }, 410); }
    if (action === "stop") await pool.query("UPDATE agent_demo_sessions SET ended_at=NOW() WHERE id=$1", [id]);
    const body = await boundedBody(request, action === "turn" ? 2_000_000 : 4096);
    const limited = new Request(request.url, { method: "POST", headers: request.headers, body, signal: request.signal });
    const response = await handleTestSession(limited, s.owner, true);
    for (const [key,value] of Object.entries(demoHeaders)) response.headers.set(key,value);
    return response;
  } catch (error) {
    if (allocated) { sessions.get(allocated)?.abort?.abort(); sessions.delete(allocated); await (await demoDb()).query("UPDATE agent_demo_sessions SET ended_at=NOW() WHERE id=$1", [allocated]).catch(() => {}); }
    return demoJson({ error: error instanceof Error && error.message === "BODY_LIMIT" ? "Request too large" : "Voice service unavailable. Try again later." }, error instanceof Error && error.message === "BODY_LIMIT" ? 413 : 503);
  }
}
