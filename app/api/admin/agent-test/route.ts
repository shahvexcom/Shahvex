import { handleTestSession } from "@/lib/agent-test-session";
import { extractAgentScript } from "@/lib/agent-script-extraction";
import { conversationStyles } from "@/lib/agent-script-details";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { db } from "@/lib/database";
import { engine, localVoices, newTest, pruneSessions, testConfig, warmSelectedVoice } from "@/lib/agent-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function admin() { const s = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); return s?.role === "ADMIN" ? s.agentId : null; }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const owner = await admin(); if (!owner) return json({ error: "Unauthenticated" }, 401);
  try {
    const id = new URL(request.url).searchParams.get("agentId");
    const result = await (await db()).query(`SELECT a.name,a.accent,a.avatar_url,a.local_voice_id,a.conversation_style,a.speaks_first,a.language,COALESCE(NULLIF(a.agent_script,''),s.script_text,'') script FROM agents a LEFT JOIN LATERAL
      (SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
      WHERE a.id=$1 AND a.role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`, [id]);
    if (!result.rows[0]) return json({ error: "Agent not found" }, 404);
    const voices = await localVoices(owner), a = result.rows[0];
    return json({ ...voices, agent: {name:a.name,avatarUrl:a.avatar_url||"",accent:a.accent,language:a.language||"English"}, config: { name: a.name, voice: a.local_voice_id||voices.defaultVoice, first: a.speaks_first||"customer", goal: "", task: "", instructions: "", script: a.script, knowledge: "", style: a.conversation_style||"Professional" } });
  } catch { return json({ error: "Unable to load agent configuration or local CosyVoice service." }, 503); }
}
export async function POST(request: Request) {
  const owner = await admin(); if (!owner) return json({ error: "Unauthenticated" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Same-origin request required" }, 403);
  pruneSessions();
  const url = new URL(request.url), action = url.searchParams.get("action"), id = url.searchParams.get("id") || "";
  try {
    if (action === "extract" || action === "preview") {
      const raw = await request.text(); if (raw.length > 70000) return json({ error: "Request too large" }, 413);
      const body = JSON.parse(raw);
      if (action === "extract") {
        if (typeof body.script !== "string" || body.script.length > 16000) return json({ error: "Invalid agent script" }, 400);
        return json({ script: body.script, details: await extractAgentScript(owner, body.script, request.signal) });
      }
      if (typeof body.voice !== "string" || !(await localVoices(owner)).voices.some(v => v.id === body.voice)) return json({ error: "Select an available local voice" }, 400);
      const response = await engine(8767, "/synthesize", { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello. This is a preview of your selected voice.", voice_id: body.voice }) });
      if (!response.ok) return json({ error: "Voice preview synthesis failed" }, 502);
      const audio = await response.arrayBuffer();
      if (audio.byteLength < 44 || audio.byteLength > 2000000) return json({ error: "Invalid voice preview audio" }, 502);
      return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    }
    if (action === "start") {
      const raw = await request.text(); if (raw.length > 70000) return json({ error: "Configuration too large" }, 413);
      const body = JSON.parse(raw), parsed = testConfig.safeParse(body.config);
      if (!parsed.success || typeof body.agentId !== "string") return json({ error: "Invalid test configuration" }, 400);
      const found = await (await db()).query("SELECT id,name FROM agents a WHERE id=$1 AND role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [body.agentId]);
      if (!found.rows[0]) return json({ error: "Agent not found" }, 404);
      if (!(await localVoices(owner)).voices.some(v => v.id === parsed.data.voice)) return json({ error: "Select an available local voice" }, 400);
      await warmSelectedVoice(parsed.data.voice);
      const details = await extractAgentScript(owner, parsed.data.script, request.signal);
      request.signal.throwIfAborted();
      const config = { ...parsed.data, name: found.rows[0].name,
        goal: details.goals.join("\n"), task: details.tasks.join("\n"),
        instructions: [...details.instructions, ...details.conversationFlow, ...details.restrictions].join("\n"),
        knowledge: [...details.knowledge, ...details.faqs].join("\n"),
        style: conversationStyles.includes(parsed.data.style as typeof conversationStyles[number]) ? parsed.data.style : "Professional",
      };
      if (process.env.SHAHVEX_PC_AI_URL) {
        const { pcAiRequest } = await import("@/lib/pc-ai-engine");
        return pcAiRequest("/tester/start", { method: "POST", signal: request.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: body.agentId, config }) }, owner);
      }
      return json({ id: newTest(owner, body.agentId, config) });
    }
    if (process.env.SHAHVEX_PC_AI_URL && ["turn", "interrupt", "stop"].includes(action || "")) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return json({ error: "Invalid session" }, 400);
      const parts: Uint8Array[] = []; let size = 0;
      if (request.body) for await (const part of request.body as unknown as AsyncIterable<Uint8Array>) { size += part.length; if (size > 2_000_000) return json({ error: "Request too large" }, 413); parts.push(part); }
      const { pcAiRequest } = await import("@/lib/pc-ai-engine");
      return pcAiRequest(`/tester/${action}`, { method: "POST", signal: request.signal,
        headers: { "content-type": request.headers.get("content-type") || "application/json", "x-shahvex-session": id, "x-shahvex-turn": url.searchParams.get("turnId") || crypto.randomUUID() }, body: Buffer.concat(parts) }, owner);
    }
    return handleTestSession(request, owner);
  } catch { return json({ error: "Local agent test request failed. Check the local services and try again." }, 503); }
}
