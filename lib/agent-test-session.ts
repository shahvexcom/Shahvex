import { streamAgentReply } from "@/lib/agent-test-stream";
import { inspectSpeechWav } from "@/lib/agent-test-audio";
import { createHash } from "node:crypto";
import { engine, sessions } from "@/lib/agent-test";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
// Shared conversation engine; callers must authorize the session before invoking.
export async function handleTestSession(request: Request, owner: string, publicDemo = false) {
  const url = new URL(request.url), action = url.searchParams.get("action"), id = url.searchParams.get("id") || "";
  try {
    const session = sessions.get(id); if (!session || session.owner !== owner) return json({ error: "Test session expired. Start again." }, 404);
    if (action === "stop") { session.abort?.abort(); sessions.delete(id); return json({ stopped: true }); }
    if (action === "interrupt") {
      session.abort?.abort();
      // Acknowledge only after the old worker has released its session, not just
      // after requesting cancellation. Remote cleanup can outlast a browser retry.
      if (session.busy && session.finished) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([session.finished, new Promise<void>(resolve => { timer = setTimeout(resolve, 10000); })]); }
        finally { clearTimeout(timer); }
      }
      return session.busy ? json({ error: "Previous turn is finishing; try again.", code: "BUSY" }, 409) : json({ interrupted: true });
    }
    if (action !== "turn") return json({ error: "Unknown action" }, 400);
    if (session.busy) return json({ error: "Previous turn is finishing; try again.", code: "BUSY" }, 409);
    const turnId = url.searchParams.get("turnId") || crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(turnId)) return json({ error: "Invalid turn ID" }, 400);
    session.turns ??= new Set(); session.recordingHashes ??= new Set();
    if (session.turns.has(turnId)) return json({ error: "This turn has already been handled", code: "DUPLICATE_TURN" }, 409);
    session.turns.add(turnId); if (session.turns.size > 200) session.turns.delete(session.turns.values().next().value!);
    const abort = new AbortController(); session.busy = true; session.abort = abort;
    let release!: () => void;
    session.finished = new Promise<void>(resolve => { release = resolve; });
    const cancel = () => abort.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) abort.abort();
    const deadline = setTimeout(() => abort.abort(), 110000);
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
        } catch (error) { if (!abort.signal.aborted) await send({ type: "error", error: publicDemo ? "Voice service unavailable. End the session and try again." : error instanceof Error ? error.message : "Local AI service failed" }); }
        finally {
          if (answer) {
            session.messages.push({ role: "assistant", content: answer + (abort.signal.aborted ? " [interrupted]" : "") });
            if (!session.messages[0].content.endsWith("The session has begun. Do not introduce yourself again.")) session.messages[0].content += "\nThe session has begun. Do not introduce yourself again.";
          }
          if (session.messages.length > 41) session.messages.splice(3, session.messages.length - 41);
          session.busy = false; session.expires = Date.now() + 30 * 60_000;
          clearTimeout(deadline); request.signal.removeEventListener("abort", cancel); release();
          try { controller.close(); } catch { /* The browser may already have cancelled the stream. */ }
        }
      }, cancel() { abort.abort(); },
    }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch { return json({ error: "Local agent test request failed. Check the local services and try again." }, 503); }
}
