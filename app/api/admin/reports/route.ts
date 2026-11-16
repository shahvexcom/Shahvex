import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

async function admin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

export async function GET(request: Request) {
  if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const [calls, metrics] = await Promise.all([
    client.query(`SELECT c.id,c.call_type,c.status,c.lead_name,c.lead_number,c.recording_url,c.summary,c.notes,c.outcome,c.created_at,c.answered_at,c.ended_at,a.name AS agent_name
      FROM agent_calls c JOIN agents a ON a.id=c.agent_id WHERE c.call_type IN ('LEAD','TEST')
        AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)
      ORDER BY c.created_at DESC ${new URL(request.url).searchParams.get("export") === "all" ? "" : "LIMIT 250"}`),
    client.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status IN ('INITIATED','RINGING','ANSWERED'))::int AS active,COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed,COUNT(*) FILTER (WHERE answered_at IS NOT NULL)::int AS answered,COUNT(*) FILTER (WHERE recording_url <> '')::int AS recordings,COUNT(*) FILTER (WHERE status='COMPLETED' AND COALESCE(summary,'')='')::int AS needs_review,COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - answered_at))) FILTER (WHERE answered_at IS NOT NULL),0)::bigint AS talk_seconds FROM agent_calls c WHERE call_type IN ('LEAD','TEST') AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)`),
  ]);
  return Response.json({ calls: calls.rows, metrics: metrics.rows[0] });
}
