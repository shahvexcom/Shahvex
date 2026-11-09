import "server-only";
import { cookies } from "next/headers";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./database";
import { ADMIN_SESSION_COOKIE, BPO_SESSION_COOKIE, AGENT_SESSION_COOKIE, readSession, type SessionPayload } from "./session";
import { ShahvexError } from "./shahvex-api";

export async function shahvexPrincipal(portal: string | null) {
  const role=portal==="bpo"?"BPO":portal==="agent"?"AGENT":"ADMIN";
  const jar=await cookies();const s=await readSession(jar.get(role==="ADMIN"?ADMIN_SESSION_COOKIE:role==="BPO"?BPO_SESSION_COOKIE:AGENT_SESSION_COOKIE)?.value);
  if(!s||s.role!==role)throw new ShahvexError(401,"Unauthenticated");
  const account=await (await db()).query("SELECT id FROM agents WHERE id=$1 AND role=$2 AND status='APPROVED'",[s.agentId,role]);
  if(!account.rowCount)throw new ShahvexError(403,"Account is not authorized");return s;
}
export async function shahvexAgent(s: SessionPayload, id: string) {
  if(!id||id.length>100)throw new ShahvexError(400,"Select an agent");
  const result=await (await db()).query(`SELECT a.id,a.name,a.avatar_url,a.local_voice_id,a.accent,a.language,a.speaks_first,a.conversation_style,
    COALESCE(NULLIF(a.agent_script,''),sc.script_text,'') script FROM agents a
    LEFT JOIN LATERAL (SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) sc ON TRUE
    WHERE a.id=$1 AND a.role='AGENT' AND a.status='APPROVED' AND (
      ($3='ADMIN' AND EXISTS(SELECT 1 FROM admin_agent_owners o WHERE o.agent_id=a.id AND o.owner_id=$2 AND o.verified=TRUE) AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)) OR
      ($3='BPO' AND EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$2)) OR
      ($3='AGENT' AND a.id=$2 AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id))
    )`,[id,s.agentId,s.role]);
  if(!result.rows[0])throw new ShahvexError(403,"Agent access is not authorized");return result.rows[0];
}
export function agentConfigHash(a: Record<string,unknown>) {
  return createHash("sha256").update(JSON.stringify([a.id,a.name,a.local_voice_id,a.accent,a.language,a.speaks_first,a.conversation_style,a.script])).digest("hex");
}
let ready: Promise<void> | undefined;
export async function shahvexDb() {
  const pool=await db();ready??=pool.query(`
    CREATE TABLE IF NOT EXISTS shahvex_agent_bindings (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      upstream_agent_id VARCHAR(64) UNIQUE NOT NULL, config_hash CHAR(64) NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL, verified_by TEXT NOT NULL REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS shahvex_sessions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, upstream_id CHAR(32) UNIQUE,
      config_hash CHAR(64) NOT NULL, upstream_agent_id VARCHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 minutes',
      closed_at TIMESTAMPTZ, busy_until TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS shahvex_turns (
      session_id TEXT NOT NULL REFERENCES shahvex_sessions(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL, PRIMARY KEY(session_id,turn_id)
    );
    CREATE TABLE IF NOT EXISTS shahvex_rate (
      owner_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      window_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), hits INTEGER NOT NULL DEFAULT 1
    );
  `).then(()=>{}).catch(e=>{ready=undefined;throw e;});await ready;return pool;
}
export async function shahvexRate(owner: string) {
  const result=await (await shahvexDb()).query(`INSERT INTO shahvex_rate(owner_id) VALUES($1) ON CONFLICT(owner_id) DO UPDATE SET
    hits=CASE WHEN shahvex_rate.window_at<NOW()-INTERVAL '1 minute' THEN 1 ELSE shahvex_rate.hits+1 END,
    window_at=CASE WHEN shahvex_rate.window_at<NOW()-INTERVAL '1 minute' THEN NOW() ELSE shahvex_rate.window_at END
    WHERE shahvex_rate.hits<60 OR shahvex_rate.window_at<NOW()-INTERVAL '1 minute' RETURNING owner_id`,[owner]);
  if(!result.rowCount)throw new ShahvexError(429,"Too many AI requests. Try again shortly.");
}
export async function shahvexBinding(a: Record<string,unknown>) {
  const row=(await (await shahvexDb()).query("SELECT upstream_agent_id,config_hash FROM shahvex_agent_bindings WHERE agent_id=$1",[a.id])).rows[0];
  if(!row||row.config_hash!==agentConfigHash(a)||!/^[A-Za-z0-9_-]{1,64}$/.test(row.upstream_agent_id))throw new ShahvexError(409,"This agent's physical configuration needs verification before testing");
  return row;
}
export async function createShahvexSession(s:SessionPayload,agentId:string) {
  const a=await shahvexAgent(s,agentId),b=await shahvexBinding(a);
  if(a.speaks_first==="ai")throw new ShahvexError(409,"The connected gateway requires customer speech first; AI-first sessions are not supported yet");
  const id=randomUUID(),client=await (await shahvexDb()).connect();
  try {
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`shahvex:${s.agentId}`]);
    const count=await client.query("SELECT COUNT(*)::int n FROM shahvex_sessions WHERE owner_id=$1 AND closed_at IS NULL AND expires_at>NOW()",[s.agentId]);
    if(count.rows[0].n>=3)throw new ShahvexError(429,"End an existing AI session before starting another");
    await client.query("INSERT INTO shahvex_sessions(id,owner_id,agent_id,config_hash,upstream_agent_id) VALUES($1,$2,$3,$4,$5)",[id,s.agentId,agentId,b.config_hash,b.upstream_agent_id]);
    await client.query("COMMIT");return id;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function ownedShahvexSession(s:SessionPayload,id:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw new ShahvexError(404,"Session not found");
  const row=(await (await shahvexDb()).query("SELECT * FROM shahvex_sessions WHERE id=$1 AND owner_id=$2 AND closed_at IS NULL AND expires_at>NOW()",[id,s.agentId])).rows[0];
  if(!row)throw new ShahvexError(404,"Session not found");
  const a=await shahvexAgent(s,row.agent_id),b=await shahvexBinding(a);
  if(b.config_hash!==row.config_hash||b.upstream_agent_id!==row.upstream_agent_id)throw new ShahvexError(409,"Agent configuration changed. Start a new session");
  return {row,agent:a};
}
export async function boundedRequest(request: Request, max:number) {
  const chunks:Uint8Array[]=[];let size=0;
  if(request.body)for await(const chunk of request.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>max)throw new ShahvexError(413,"Request is too large");chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export function sameOrigin(request:Request) {if(request.headers.get("origin")!==new URL(request.url).origin)throw new ShahvexError(403,"Same-origin request required");}
