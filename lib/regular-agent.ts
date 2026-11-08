import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { AGENT_SESSION_COOKIE, readSession } from "@/lib/session";

/**
 * BPO calling agents share the agents table because they use the same calling
 * engine, but they are owned by a BPO workspace and must never enter the
 * standalone Agent or Controller workflows.
 */
export async function isRegularAgent(agentId: string) {
  const result = await (await db()).query(
    `SELECT 1
     FROM agents a
     WHERE a.id=$1
       AND a.role='AGENT'
       AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)
     LIMIT 1`,
    [agentId],
  );
  return Boolean(result.rows[0]);
}

export async function requireRegularAgent() {
  const session = await readSession((await cookies()).get(AGENT_SESSION_COOKIE)?.value);
  if (!session || session.role !== "AGENT" || !await isRegularAgent(session.agentId)) return null;
  return session;
}
