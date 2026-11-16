import { cloneVoicePreview } from "@/lib/clone-voice-preview";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { engine, localVoices } from "@/lib/agent-test";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Same-origin request required" }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.voice === "string") { const preview = await cloneVoicePreview(session.agentId, body.voice); if (preview) return preview; }
    if (typeof body.voice !== "string" || !(await localVoices(session.agentId)).voices.some(v => v.id === body.voice)) return Response.json({ error: "Choose an available local voice to preview" }, { status: 400 });
    const response = await engine(8767, "/synthesize", { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello. This is a preview of your selected voice.", voice_id: body.voice }) });
    if (!response.ok) throw Error();
    const audio = await response.arrayBuffer();
    if (audio.byteLength < 44 || audio.byteLength > 2000000) throw Error();
    return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Voice preview is unavailable. Please try again." }, { status: 503 }); }
}
