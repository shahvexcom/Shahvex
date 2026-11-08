import { db } from "@/lib/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await (await db()).query(`SELECT
      (SELECT COUNT(*)::int FROM agents WHERE role='AGENT' AND status='APPROVED') AS approved_agents,
      (SELECT COUNT(*)::int FROM agent_calls WHERE status='COMPLETED') AS completed_calls,
      (SELECT COUNT(*)::int FROM agent_calls WHERE status IN ('INITIATED','RINGING','ANSWERED')) AS active_calls,
      (SELECT COUNT(*)::int FROM agents a WHERE role='AGENT' AND status='APPROVED' AND EXISTS (SELECT 1 FROM agent_credentials c WHERE c.agent_id=a.id AND c.provider='TELNYX')) AS configured_agents`);
    return Response.json({ overview: result.rows[0] });
  } catch {
    return Response.json({ message: "Overview is temporarily unavailable." }, { status: 503 });
  }
}
