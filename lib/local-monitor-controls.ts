import { recordingReference } from "./recording-reference";
import { z } from "zod";
import { db } from "./database";
import { principal } from "./voip-controller";
import { decryptCredential } from "./credential-crypto";
import { bridgeSignature } from "./vicidial-bridge";
import { localBridgeURL } from "./local-monitor-connection";

const command = z.object({ id: z.string().uuid(), action: z.enum(["hangup", "record-start", "record-stop"]) });
/** Local test calls never use campaign control or recording credentials. */
export async function localMonitorControl(portal: "admin" | "bpo", request: Request) {
  const owner = await principal(portal);
  if (!owner) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ message: "Same-origin request required." }, { status: 403 });
  const value = request.method === "POST" ? command.safeParse(await request.json().catch(() => null)) : z.object({ id: z.string().uuid() }).safeParse({ id: new URL(request.url).searchParams.get("id") });
  if (!value.success) return Response.json({ message: "Invalid call action." }, { status: 400 });
  const row = (await (await db()).query("SELECT local_url,local_secret_ciphertext FROM live_monitor_settings WHERE owner_id=$1", [owner])).rows[0];
  if (!row?.local_url || !row.local_secret_ciphertext) return Response.json({ message: "Local bridge not connected." }, { status: 409 });
  try {
    const base = localBridgeURL(row.local_url), secret = decryptCredential(row.local_secret_ciphertext);
    async function signed(path: string, body?: object) {
      const method = body ? "POST" : "GET", raw = body ? JSON.stringify(body) : "", time = String(Date.now());
      return fetch(base + path, { method, redirect: "error", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]), headers: { "content-type": "application/json", "x-shahvex-timestamp": time, "x-shahvex-signature": bridgeSignature(secret, time, method, path, Buffer.from(raw)) }, ...(body ? { body: raw } : {}) });
    }
    const monitor = await signed("/local-monitor"), data = await monitor.json();
    const call = monitor.ok && data.testOnly === true && Array.isArray(data.calls) ? data.calls.find((item: { id: string }) => item.id === value.data.id) : null;
    if (!call) return Response.json({ message: "Local call not found." }, { status: 404 });
    if (request.method === "GET") {
      if (!z.string().uuid().safeParse(call.ai_recording_id).success) return Response.json({ message: "Stop recording or wait for the call to end before downloading." }, { status: 409 });
      const audio = await signed(`/recordings/${call.ai_recording_id}.wav`);
      if (!audio.ok || !audio.body) return Response.json({ message: "Recording is not ready." }, { status: 404 });
      return new Response(audio.body, { headers: { "Content-Type": "audio/wav", "Content-Disposition": `attachment; filename="recording-${recordingReference({id:value.data.id},true)}.wav"`, "X-Recording-Serial": recordingReference({id:value.data.id},true), "Cache-Control": "private, no-store" } });
    }
    const action = (value.data as z.infer<typeof command>).action;
    const result = await signed("/command", { callId: value.data.id, action: action === "hangup" ? "close-audio" : action }), response = await result.json();
    if (!result.ok || response.accepted !== true) return Response.json({ message: response.error || "Call action not confirmed." }, { status: 409 });
    return Response.json({ message: action === "hangup" ? "Ending selected call." : action === "record-stop" ? "AI recording stopped. The call continues." : "AI recording started.", recording_active: response.recordingActive, ai_recording_id: response.aiRecordingId || call.ai_recording_id });
  } catch { return Response.json({ message: "Local bridge unavailable. Check the call before retrying." }, { status: 503 }); }
}
