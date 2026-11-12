import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { decryptCredential } from "@/app/api/admin/credentials/route";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (session?.role !== "ADMIN") return Response.json({ message: "Unauthenticated" }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ message: "Invalid call ID." }, { status: 400 });
  const result = await (await db()).query(`SELECT c.telephony_provider,c.call_type,c.recording_id,c.recording_url,t.secret_ciphertext
    FROM agent_calls c
    LEFT JOIN agent_credentials ac ON ac.agent_id=c.agent_id AND ac.provider='TELNYX'
    LEFT JOIN ai_credentials t ON t.id=ac.credential_id
    WHERE c.id=$1 AND (
      (c.agent_id=$2 AND c.call_type='QUICK_DIAL') OR
      (c.call_type<>'QUICK_DIAL' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id))
    ) LIMIT 1`, [id, session.agentId]);
  const call = result.rows[0];
  if (!call) return Response.json({ message: "Call not found." }, { status: 404 });

  if(call.telephony_provider==='VICIDIAL')return (await import("@/lib/vicidial-recording")).vicidialRecordingResponse(id,request);
  let audioUrl = String(call.recording_url || "");
  if (call.recording_id && call.secret_ciphertext && call.call_type !== "QUICK_DIAL") {
    const metadata = await fetch(`https://api.telnyx.com/v2/recordings/${encodeURIComponent(call.recording_id)}`, {
      headers: { Authorization: `Bearer ${decryptCredential(call.secret_ciphertext)}`, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await metadata.json().catch(() => ({}));
    if (metadata.ok) audioUrl = String(body?.data?.download_urls?.mp3 || body?.data?.download_urls?.wav || audioUrl);
  }
  if (!audioUrl) return Response.json({ message: "Recording is not ready yet." }, { status: 404 });

  const requestedRange = request.headers.get("range");
  const audio = await fetch(audioUrl, { cache: "no-store", headers: requestedRange ? { Range: requestedRange } : undefined });
  if (!audio.ok || !audio.body) return Response.json({ message: "Recording could not be downloaded." }, { status: 502 });
  const contentType = audio.headers.get("content-type") || "audio/mpeg";
  const extension = contentType.includes("webm") ? "webm" : contentType.includes("ogg") ? "ogg" : contentType.includes("wav") ? "wav" : "mp3";
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `${new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="call-${id.slice(0, 8)}.${extension}"`,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": audio.headers.get("accept-ranges") || "bytes",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = audio.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(audio.body, {
    status: audio.status === 206 ? 206 : 200,
    headers,
  });
}
