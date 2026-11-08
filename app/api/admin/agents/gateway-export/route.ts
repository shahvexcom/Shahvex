import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { db } from "@/lib/database";

export const runtime = "nodejs";

/** Read-only controller export. No gateway secret, lead data or provider credentials. */
export async function GET(request: Request) {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };
  if (session?.role !== "ADMIN") return Response.json({ error: "Unauthenticated" }, { status: 401, headers });
  const id = new URL(request.url).searchParams.get("agentId");
  if (!id || id.length > 200) return Response.json({ error: "Agent ID required" }, { status: 400, headers });
  const result = await (await db()).query(`SELECT a.name,s.script_text
    FROM agents a JOIN LATERAL (
      SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    WHERE a.id=$1 AND a.role='AGENT' AND a.status='APPROVED'
      AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`, [id]);
  const agent = result.rows[0];
  if (!agent) return Response.json({ error: "Approved controller agent with assigned script not found" }, { status: 404, headers });
  if (!String(agent.script_text || "").trim() || agent.script_text.length > 16000)
    return Response.json({ error: "Assigned script must contain 1–16000 characters" }, { status: 409, headers });
  // This profile is the sole verified physical-engine default, not a gender/accent claim.
  return Response.json({ agentName: agent.name, campaignId: `website-rehearsal:${id}`,
    direction: "inbound", voiceId: "existing-chatterbox-default", script: agent.script_text }, {
    headers: { ...headers, "Content-Disposition": 'attachment; filename="shahvex-agent-rehearsal.json"' },
  });
}
