import { withNativeLiveCalls } from "./native-live-calls";
import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { requireApprovedBpo } from "@/lib/bpo-session";

export async function liveCallMonitor(portal: "admin" | "bpo", params: URLSearchParams) {
  const session = portal === "bpo" ? await requireApprovedBpo()
    : await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== (portal === "bpo" ? "BPO" : "ADMIN")) {
    return Response.json({ message: "Please sign in to view live calls." }, { status: 401 });
  }
  const scope = portal === "bpo"
    ? "EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id AND b.bpo_id=$1)"
    : "NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)";
  const values: string[] = portal === "bpo" ? [session.agentId] : [];
  const cursorAt = params.get("before");
  const cursorId = params.get("id");
  if ((cursorAt !== null || cursorId !== null) &&
      (!cursorAt || !cursorId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(cursorAt) ||
       !Number.isFinite(Date.parse(cursorAt)))) {
    return Response.json({ message: "Invalid call history cursor." }, { status: 400 });
  }
  const historyOnly = params.get("history") === "1";
  const live = "(c.status IN ('INITIATED','RINGING','ANSWERED') AND NOT c.customer_ended)";
  const cursor = historyOnly && cursorAt !== null && cursorId !== null
    ? `AND (c.created_at,c.id) < ($${values.push(cursorAt)}::timestamptz,$${values.push(cursorId)})`
    : "";
  const result = await (await db()).query(`SELECT c.recording_serial,c.id,c.agent_id,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar,
    c.voip_connection_id,c.vicidial_call_id,c.telephony_provider,c.direct_audio_line,
    CASE WHEN c.customer_ended AND c.status IN ('INITIATED','RINGING','ANSWERED') THEN 'COMPLETED' ELSE c.status END status,
    CASE WHEN c.customer_ended AND c.status IN ('INITIATED','RINGING','ANSWERED') THEN 'COMPLETED' ELSE c.conversation_state END conversation_state,c.conversation_busy,c.lead_name,c.lead_number,
    c.vicidial_agent_user,c.external_campaign_id,c.asterisk_uniqueid,
    c.transfer_status,c.end_initiation,c.customer_ended,c.ending_requested,c.ai_leg_released,c.ai_media_ended_at,c.ai_recording_id,(c.status='ANSWERED' AND NOT c.ai_leg_released AND (c.recording_active OR c.ai_recording_id IS NULL)) recording_active,c.conversation_history,c.transcript,c.created_at,c.updated_at,c.ended_at,
    to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') history_at
    FROM agent_calls c JOIN agents a ON a.id=c.agent_id
    WHERE a.deleted_at IS NULL AND c.telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND ${scope}
    AND (${historyOnly ? `NOT (${live}) ${cursor}` : `${live} OR COALESCE(c.ended_at,c.updated_at) >= NOW()-INTERVAL '30 minutes'`})
    ORDER BY c.created_at DESC,c.id DESC
    ${historyOnly ? "LIMIT 51" : ""}`, values);
  const headers = { "Cache-Control": "no-store" };
  if (historyOnly) {
    const calls = result.rows.slice(0, 50);
    return Response.json({ calls, has_more: result.rows.length > 50 }, { headers });
  }
  return Response.json(await withNativeLiveCalls(result.rows,portal,session.agentId), { headers });
}
