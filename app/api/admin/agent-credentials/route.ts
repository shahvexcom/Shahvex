import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const assignmentSchema = z.object({
  agentId: z.string().min(1),
  groqCredentialId: z.string().min(1).nullable(),
  telnyxCredentialId: z.string().min(1).nullable(),
});

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const [agents, credentials, assignments] = await Promise.all([
    client.query("SELECT id,name,username FROM agents a WHERE role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) ORDER BY name"),
    client.query("SELECT id,provider,label FROM ai_credentials ORDER BY provider,label"),
    client.query("SELECT ac.agent_id,ac.provider,ac.credential_id FROM agent_credentials ac WHERE NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=ac.agent_id)"),
  ]);
  return Response.json({ agents: agents.rows, credentials: credentials.rows, assignments: assignments.rows });
}

export async function PUT(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = assignmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Invalid credential assignment." }, { status: 400 });
  const value = parsed.data, client = await db();
  const agent = await client.query("SELECT id FROM agents a WHERE id=$1 AND role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [value.agentId]);
  if (!agent.rows[0]) return Response.json({ message: "Agent not found." }, { status: 404 });
  const requested = [["GROQ", value.groqCredentialId], ["TELNYX", value.telnyxCredentialId]] as const;
  for (const [provider, credentialId] of requested) if (credentialId) {
    const credential = await client.query("SELECT id FROM ai_credentials WHERE id=$1 AND provider=$2", [credentialId, provider]);
    if (!credential.rows[0]) return Response.json({ message: `Selected ${provider} credential is not available.` }, { status: 400 });
  }
  try {
    for (const [provider, credentialId] of requested) {
      if (credentialId) await client.query("INSERT INTO agent_credentials (agent_id,provider,credential_id) VALUES ($1,$2,$3) ON CONFLICT (agent_id,provider) DO UPDATE SET credential_id=EXCLUDED.credential_id,assigned_at=NOW()", [value.agentId, provider, credentialId]);
      else await client.query("DELETE FROM agent_credentials WHERE agent_id=$1 AND provider=$2", [value.agentId, provider]);
    }
  } catch { return Response.json({ message: "Unable to save credential assignment." }, { status: 500 }); }
  const assignments = await client.query("SELECT provider,credential_id FROM agent_credentials WHERE agent_id=$1 ORDER BY provider", [value.agentId]);
  return Response.json({ message: "Credentials assigned to agent.", assignments: assignments.rows });
}
