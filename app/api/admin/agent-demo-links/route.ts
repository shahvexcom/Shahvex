import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { demoDb, demoHash, demoJson, demoToken } from "@/lib/agent-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function owner() { const s = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); return s?.role === "ADMIN" ? s.agentId : null; }
export async function GET() {
  const id = await owner(); if (!id) return demoJson({ error: "Unauthenticated" }, 401);
  try {
    const p = await demoDb();
    const rows = await p.query(`SELECT l.id,l.agent_id,l.expires_at,l.revoked_at,l.max_sessions,l.used_sessions,
      (SELECT COUNT(*)::int FROM agent_demo_sessions s WHERE s.link_id=l.id AND s.ended_at IS NULL AND s.expires_at>NOW()) active_sessions
      FROM agent_demo_links l WHERE l.owner_id=$1 ORDER BY l.created_at DESC`, [id]);
    return demoJson({ links: rows.rows });
  } catch { return demoJson({ error: "Unable to load links" }, 503); }
}
export async function POST(request: Request) {
  const id = await owner(); if (!id) return demoJson({ error: "Unauthenticated" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return demoJson({ error: "Same-origin request required" }, 403);
  try {
    if (Number(request.headers.get("content-length") || 0) > 4096) return demoJson({ error: "Request too large" }, 413);
    const raw = await request.text(); if (raw.length > 4096) return demoJson({ error: "Request too large" }, 413);
    const body = JSON.parse(raw), p = await demoDb();
    if (body.action === "revoke") {
      await p.query(`WITH revoked AS (UPDATE agent_demo_links SET revoked_at=NOW() WHERE id=$1 AND owner_id=$2 RETURNING id)
        UPDATE agent_demo_sessions SET ended_at=NOW() WHERE link_id IN (SELECT id FROM revoked) AND ended_at IS NULL`, [body.id, id]);
      return demoJson({ revoked: true });
    }
    if (body.action !== "generate") return demoJson({ error: "Unknown action" }, 400);
    const hours = Number(body.hours ?? 24), max = Number(body.maxSessions ?? 10);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isInteger(max) || max < 1 || max > 1000) return demoJson({ error: "Invalid expiry or usage" }, 400);
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      const a = await client.query(`SELECT a.id FROM agents a JOIN admin_agent_owners o ON o.agent_id=a.id AND o.owner_id=$1 AND o.verified=TRUE
        WHERE a.id=$2 AND a.role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) FOR UPDATE OF a`, [id, body.agentId]);
      if (!a.rowCount) { await client.query("ROLLBACK"); return demoJson({ error: "Agent ownership must be verified" }, 403); }
      await client.query(`WITH revoked AS (UPDATE agent_demo_links SET revoked_at=NOW() WHERE agent_id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id)
        UPDATE agent_demo_sessions SET ended_at=NOW() WHERE link_id IN (SELECT id FROM revoked) AND ended_at IS NULL`, [body.agentId, id]);
      const token = demoToken(), linkId = randomUUID();
      await client.query("INSERT INTO agent_demo_links(id,token_hash,agent_id,owner_id,expires_at,max_sessions) VALUES($1,$2,$3,$4,NOW()+$5*INTERVAL '1 hour',$6)", [linkId,demoHash(token),body.agentId,id,hours,max]);
      await client.query("COMMIT");
      return demoJson({ id: linkId, path: `/test/agent/${token}` });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch { return demoJson({ error: "Unable to update test link" }, 503); }
}
