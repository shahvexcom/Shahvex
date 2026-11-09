import { streamAgentReply } from "@/lib/agent-test-stream";
import { extractAgentScript } from "@/lib/agent-script-extraction";
import { conversationStyles } from "@/lib/agent-script-details";
import { inspectSpeechWav } from "@/lib/agent-test-audio";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { db } from "@/lib/database";
import { engine, localVoices, newTest, pruneSessions, sessions, testConfig, warmSelectedVoice } from "@/lib/agent-test";

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
      return json({ id: newTest(owner, body.agentId, { ...parsed.data, name: found.rows[0].name,
        goal: details.goals.join("\n"), task: details.tasks.join("\n"),
        instructions: [...details.instructions, ...details.conversationFlow, ...details.restrictions].join("\n"),
        knowledge: [...details.knowledge, ...details.faqs].join("\n"),
        style: conversationStyles.includes(parsed.data.style as typeof conversationStyles[number]) ? parsed.data.style : "Professional",
      }) });
    }
    const session = sessions.get(id); if (!session || session.owner !== owner) return json({ error: "Test session expired. Start again." }, 404);
    if (action === "stop") { session.abort?.abort(); sessions.delete(id); return json({ stopped: true }); }
    if (action === "interrupt") { session.abort?.abort(); return json({ interrupted: true }); }
    if (action !== "turn") return json({ error: "Unknown action" }, 400);
    if (session.busy) return json({ error: "Previous turn is finishing; try again.", code: "BUSY" }, 409);
    const turnId = url.searchParams.get("turnId") || crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(turnId)) return json({ error: "Invalid turn ID" }, 400);
    session.turns ??= new Set(); session.recordingHashes ??= new Set();
    if (session.turns.has(turnId)) return json({ error: "This turn has already been handled", code: "DUPLICATE_TURN" }, 409);
    session.turns.add(turnId); if (session.turns.size > 200) session.turns.delete(session.turns.values().next().value!);
    const abort = new AbortController(); session.busy = true; session.abort = abort;
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const started = performance.now();
        const send = async (event: object) => {
          while ((controller.desiredSize ?? 0) <= 0) { abort.signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 10)); }
          abort.signal.throwIfAborted(); controller.enqueue(enc.encode(JSON.stringify({ ...event, turnId }) + "\n"));
        };
        const timing = async (stage: string, details: object = {}) => {
          const event = { type: "timing", stage, elapsedMs: Math.round(performance.now() - started), ...details };
          console.info("[Shahvex agent test]", { turnId, ...event }); await send(event);
        };
        let answer = "";
        try {
          let text = "";
          if (request.headers.get("content-type")?.startsWith("audio/wav")) {
            const parts: Uint8Array[] = []; let size = 0;
            if (request.body) for await (const part of request.body as unknown as AsyncIterable<Uint8Array>) { size += part.length; if (size > 2_000_000) throw Error("Recording too long"); parts.push(part); }
            const bytes = Buffer.concat(parts), metrics = inspectSpeechWav(bytes), hash = createHash("sha256").update(bytes).digest("hex");
            await timing("audio-validated", metrics);
            if (!metrics.speech || session.recordingHashes!.has(hash)) {
              if (process.env.NODE_ENV === "development") console.debug("[Shahvex microphone turn]", { turnId, ...metrics, committed: false, reason: metrics.speech ? "duplicate-audio" : "no-speech" });
              await send({ type: "rejected", reason: "No new confirmed speech detected" }); await send({ type: "done" }); return;
            }
            session.recordingHashes!.add(hash); if (session.recordingHashes!.size > 100) session.recordingHashes!.delete(session.recordingHashes!.values().next().value!);
            const form = new FormData(); form.append("audio", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
            const r = await engine(8766, "/transcribe", { method: "POST", body: form, signal: abort.signal });
            if (!r.ok) throw Error("Parakeet transcription failed"); text = String((await r.json()).text || "").trim();
            await timing("stt-completed");
            abort.signal.throwIfAborted();
            if (process.env.NODE_ENV === "development") console.debug("[Shahvex microphone turn]", { turnId, ...metrics, transcript: text, committed: false, state: "transcribed" });
            if (!text) { await send({ type: "done" }); return; }
          } else {
            const raw = await request.text(); if (raw.length > 5000) throw Error("Message too long");
            const body = JSON.parse(raw); text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text && !(body.opening === true && session.config.first === "ai" && session.messages.length === 1)) throw Error("Message required");
          }
          abort.signal.throwIfAborted();
          if (text) { if (process.env.NODE_ENV === "development") console.debug("[Shahvex transcript commit]", { turnId, source: request.headers.get("content-type")?.startsWith("audio/wav") ? "stt" : "typed", committed: true }); session.messages.push({ role: "user", content: text }); await send({ type: "user", text, final: true, source: request.headers.get("content-type")?.startsWith("audio/wav") ? "stt" : "typed" }); }
          const hasTask = Boolean(session.config.goal.trim() || session.config.task.trim() || session.config.script.trim());
          const messages = text ? session.messages : [...session.messages, { role: "user", content: hasTask
            ? "Begin with a brief introduction and follow only the configured task. Do not invent details or unrelated topics."
            : "Introduce yourself briefly and ask how you can help. No business scenario or task has been assigned; do not invent one." }];
          await streamAgentReply({ messages, voice: session.config.voice, signal: abort.signal, engine, send, timing, onText: text => { answer = text; } });
          await send({ type: "done" });
        } catch (error) { if (!abort.signal.aborted) await send({ type: "error", error: error instanceof Error ? error.message : "Local AI service failed" }); }
        finally {
          if (answer) {
            session.messages.push({ role: "assistant", content: answer + (abort.signal.aborted ? " [interrupted]" : "") });
            if (!session.messages[0].content.endsWith("The session has begun. Do not introduce yourself again.")) session.messages[0].content += "\nThe session has begun. Do not introduce yourself again.";
          }
          if (session.messages.length > 41) session.messages.splice(3, session.messages.length - 41);
          session.busy = false; session.expires = Date.now() + 30 * 60_000;
          try { controller.close(); } catch { /* The browser may already have cancelled the stream. */ }
        }
      }, cancel() { abort.abort(); },
    }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch { return json({ error: "Local agent test request failed. Check the local services and try again." }, 503); }
}
