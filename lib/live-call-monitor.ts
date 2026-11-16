import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { requireApprovedBpo } from "@/lib/bpo-session";

export async function liveCallMonitor(portal: "admin" | "bpo") {
  const session = portal === "bpo" ? await requireApprovedBpo()
    : await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== (portal === "bpo" ? "BPO" : "ADMIN")) {
    return Response.json({ message: "Please sign in to view live calls." }, { status: 401 });
  }
  const scope = portal === "bpo"
    ? "EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id AND b.bpo_id=$1)"
    : "NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)";
  const result = await (await db()).query(`SELECT c.id,c.agent_id,a.name agent_name,
    c.telephony_provider,c.direct_audio_line,c.status,c.conversation_state,c.conversation_busy,c.lead_name,c.lead_number,
    c.vicidial_agent_user,c.external_campaign_id,c.asterisk_uniqueid,
    c.conversation_history,c.transcript,c.created_at,c.updated_at,c.ended_at
    FROM agent_calls c JOIN agents a ON a.id=c.agent_id
    WHERE a.deleted_at IS NULL AND c.telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND ${scope}
    AND (c.status IN ('INITIATED','RINGING','ANSWERED') OR c.updated_at>NOW()-INTERVAL '30 minutes')
    ORDER BY (c.status IN ('INITIATED','RINGING','ANSWERED')) DESC,c.created_at DESC LIMIT 100`,
  portal === "bpo" ? [session.agentId] : []);
  return Response.json({ calls: result.rows }, { headers: { "Cache-Control": "no-store" } });
}
