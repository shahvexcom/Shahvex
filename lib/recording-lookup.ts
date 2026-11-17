import { cookies } from "next/headers";
import { db } from "./database";
import { ADMIN_SESSION_COOKIE, readSession } from "./session";
import { requireApprovedBpo } from "./bpo-session";
import { parseRecordingReference, recordingReference } from "./recording-reference";

/** Exact indexed lookup across all history; never returns storage URLs or secrets. */
export async function recordingLookup(portal: "admin" | "bpo", request: Request) {
  const session = portal === "bpo" ? await requireApprovedBpo() : await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== (portal === "bpo" ? "BPO" : "ADMIN")) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const serial = parseRecordingReference(new URL(request.url).searchParams.get("serial") || "");
  if (!serial) return Response.json({ message: "Enter a recording serial such as REC-000123." }, { status: 400 });
  try {
    const scope = portal === "bpo" ? "(EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id AND b.bpo_id=$2) OR (c.agent_id=$2 AND c.call_type='QUICK_DIAL'))" : "(NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id) AND (c.call_type<>'QUICK_DIAL' OR c.agent_id=$2))";
    const call = (await (await db()).query(`SELECT c.id,c.recording_serial,c.call_type,c.status,c.created_at,c.ended_at,a.name agent_name,c.lead_name,c.lead_number,(c.ai_recording_id IS NOT NULL OR NULLIF(c.recording_id,'') IS NOT NULL OR NULLIF(c.recording_url,'') IS NOT NULL) recording_ready FROM agent_calls c JOIN agents a ON a.id=c.agent_id WHERE c.recording_serial=$1::bigint AND ${scope}`, [serial, session.agentId])).rows[0];
    if (!call) return Response.json({ message: "Recording serial not found in your call history." }, { status: 404 });
    return Response.json({ call: { ...call, serial: recordingReference(call), detail_url: call.call_type === "LEAD" ? `${portal === "admin" ? "/controler" : "/bpo"}/calls/${call.id}` : null, download_url: call.recording_ready ? `/api/${portal}/calls/${call.id}/recording` : null } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ message: "Recording lookup is temporarily unavailable." }, { status: 503 }); }
}
