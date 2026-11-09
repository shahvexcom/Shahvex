import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./database";
import { ADMIN_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "./session";
import { encryptCredential, decryptCredential } from "./credential-crypto";
import { testVicidial, vicidialURL } from "./vicidial";
type Portal = "admin" | "bpo";
const connection = z.object({ action: z.literal("save"), id: z.string().max(100).optional(), name: z.string().trim().min(2).max(80), serverUrl: z.string().max(500), username: z.string().trim().min(2).max(20).regex(/^[\w-]+$/), secret: z.string().min(1).max(2000).optional(), method: z.literal("NON_AGENT_API"), enabled: z.boolean() });
const routing = z.object({ action: z.literal("assign"), agentId: z.string().max(100), connectionId: z.string().max(100), direction: z.enum(["INBOUND","OUTBOUND"]), campaignId: z.string().trim().max(80), inboundDid: z.string().trim().max(80), inGroup: z.string().trim().max(80), routingDestination: z.string().trim().max(160) }).refine(v => v.direction === "OUTBOUND" ? Boolean(v.campaignId) : Boolean(v.inboundDid || v.inGroup || v.routingDestination), { message: "Specify an outbound campaign or an inbound routing destination" });
const publicColumns = "id,name,server_url,username,method,enabled,status,last_tested_at,status_message,revision,updated_at";
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const controllerAgentSQL = `(NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) AND NOT EXISTS (SELECT 1 FROM admin_agent_owners o JOIN agents tenant ON tenant.id=o.owner_id WHERE o.agent_id=a.id AND tenant.role='BPO'))`;
export const ownedAgentSQL = `(EXISTS (SELECT 1 FROM admin_agent_owners o WHERE o.agent_id=a.id AND o.owner_id=$1 AND o.verified=TRUE) OR EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$1))`;
async function principal(portal: Portal) {
  const s = await readSession((await cookies()).get(portal === "admin" ? ADMIN_SESSION_COOKIE : BPO_SESSION_COOKIE)?.value);
  if (!s || s.role !== portal.toUpperCase()) return null;
  const r = await (await db()).query("SELECT id,admin_role,admin_permissions FROM agents WHERE id=$1 AND role=$2 AND status='APPROVED'", [s.agentId,s.role]);
  const a = r.rows[0]; if (!a || (portal === "admin" && a.admin_role !== "SUPER_ADMIN" && !a.admin_permissions?.some((p: string) => ["voip","credentials"].includes(p)))) return null;
  return s.agentId;
}
export async function getVoip(_request: Request, portal: Portal) {
  try {
    const owner = await principal(portal); if (!owner) return reply({ error: "VoIP access is not authorized" }, 403);
    const client = await db(); const [connections, assignments, agents] = await Promise.all([
      client.query(`SELECT ${publicColumns} FROM voip_connections WHERE owner_id=$1 ORDER BY created_at DESC`, [owner]),
      client.query("SELECT id,agent_id,connection_id,direction,campaign_id,inbound_did,in_group,routing_destination,updated_at FROM voip_agent_assignments WHERE owner_id=$1", [owner]),
      portal === "admin" ? client.query(`SELECT a.id,a.name,a.status FROM agents a WHERE a.role='AGENT' AND ${controllerAgentSQL} ORDER BY a.name`) : client.query("SELECT a.id,a.name,a.status FROM agents a JOIN bpo_created_agents b ON b.agent_id=a.id WHERE b.bpo_id=$1 ORDER BY a.name",[owner]),
    ]);
    return reply({ connections: connections.rows.map(c => ({ ...c, hasSecret: true })), assignments: assignments.rows, agents: agents.rows });
  } catch { return reply({ error: "Unable to load VoIP configuration" }, 503); }
}
export async function postVoip(request: Request, portal: Portal) {
  try {
    const owner = await principal(portal); if (!owner) return reply({ error: "VoIP access is not authorized" }, 403);
    if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Same-origin request required" }, 403);
    const raw = await request.text(); if (raw.length > 12000) return reply({ error: "Request too large" }, 413);
    const body = JSON.parse(raw), client = await db();
    if (body.action === "claim-legacy") return reply({error:"Ownership changes are not part of controller VoIP setup"},403);
    if (body.action === "save-assigned") {
      const parsed = connection.safeParse({...body,action:"save"});
      const assignment = routing.safeParse({...body,action:"assign",agentId:"selected",connectionId:"selected"});
      const ids = z.array(z.string().min(1).max(100)).min(1).max(200).safeParse(body.agentIds);
      if (!parsed.success || !assignment.success || !ids.success) return reply({error:"Select at least one controller agent and provide valid connection and routing details"},400);
      const v=parsed.data, r=assignment.data, agentIds=[...new Set(ids.data)];
      let url:string; try { url=vicidialURL(v.serverUrl).href; } catch { return reply({error:"Enter a valid allowed VICIdial server URL"},400); }
      if(!v.id && !v.secret)return reply({error:"API secret is required for a new connection"},400);
      if(!process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.AUTH_SECRET)return reply({error:"Server credential encryption key is not configured"},503);
      const tx=await client.connect();
      try {
        await tx.query("BEGIN");
        const valid=await tx.query(`SELECT a.id FROM agents a WHERE a.id=ANY($1::text[]) AND a.role='AGENT' AND ${portal==="admin"?controllerAgentSQL:"EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$2)"} FOR UPDATE OF a`,portal==="admin"?[agentIds]:[agentIds,owner]);
        if(valid.rowCount!==agentIds.length){await tx.query("ROLLBACK");return reply({error:"Only controller agents can be assigned to this connection"},400);}
        const id=v.id||randomUUID();
        const saved=v.id?await tx.query(`UPDATE voip_connections SET name=$1,server_url=$2,username=$3,secret_ciphertext=COALESCE($4,secret_ciphertext),method=$5,enabled=$6,status='NOT_TESTED',status_message='',last_tested_at=NULL,revision=revision+1,updated_at=NOW() WHERE id=$7 AND owner_id=$8 RETURNING ${publicColumns}`,[v.name,url,v.username,v.secret?encryptCredential(v.secret):null,v.method,v.enabled,id,owner]):await tx.query(`INSERT INTO voip_connections(id,owner_id,name,server_url,username,secret_ciphertext,method,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${publicColumns}`,[id,owner,v.name,url,v.username,encryptCredential(v.secret!),v.method,v.enabled]);
        if(!saved.rows[0]){await tx.query("ROLLBACK");return reply({error:"Connection not found"},404);}
        await tx.query("DELETE FROM voip_agent_assignments WHERE owner_id=$1 AND connection_id=$2 AND NOT(agent_id=ANY($3::text[]))",[owner,id,agentIds]);
        for(const agentId of agentIds) await tx.query(`INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction,campaign_id,inbound_did,in_group,routing_destination) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,agent_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,direction=EXCLUDED.direction,campaign_id=EXCLUDED.campaign_id,inbound_did=EXCLUDED.inbound_did,in_group=EXCLUDED.in_group,routing_destination=EXCLUDED.routing_destination,updated_at=NOW()`,[randomUUID(),owner,agentId,id,r.direction,r.campaignId,r.inboundDid,r.inGroup,r.routingDestination]);
        await tx.query("COMMIT");return reply({connection:saved.rows[0],saved:true},v.id?200:201);
      } catch(error) {await tx.query("ROLLBACK");throw error;} finally {tx.release();}
    }
    if (body.action === "save") {
      const p = connection.safeParse(body); if (!p.success) return reply({ error: p.error.issues[0].message }, 400);
      const v = p.data; let serverUrl: string;
      try { serverUrl = vicidialURL(v.serverUrl).href; } catch (e) { return reply({ error: e instanceof Error ? e.message : "Invalid server URL" }, 400); }
      if (!process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.AUTH_SECRET) return reply({ error: "Server credential encryption key is not configured" }, 503);
      if (v.id) {
        const updated = await client.query(`UPDATE voip_connections SET name=$1,server_url=$2,username=$3,secret_ciphertext=COALESCE($4,secret_ciphertext),method=$5,enabled=$6,
          status='NOT_TESTED',status_message='',last_tested_at=NULL,revision=revision+1,updated_at=NOW() WHERE id=$7 AND owner_id=$8 RETURNING ${publicColumns}`,
          [v.name,serverUrl,v.username,v.secret ? encryptCredential(v.secret) : null,v.method,v.enabled,v.id,owner]);
        if (!updated.rows[0]) return reply({ error: "Connection not found" }, 404); return reply({ connection: updated.rows[0] });
      }
      if (!v.secret) return reply({ error: "API secret is required for a new connection" }, 400);
      const created = await client.query(`INSERT INTO voip_connections(id,owner_id,name,server_url,username,secret_ciphertext,method,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${publicColumns}`, [randomUUID(),owner,v.name,serverUrl,v.username,encryptCredential(v.secret),v.method,v.enabled]);
      return reply({ connection: created.rows[0] }, 201);
    }
    if (body.action === "test") {
      if (typeof body.id !== "string") return reply({ error: "Connection ID required" }, 400);
      const r = await client.query("SELECT id,server_url,username,secret_ciphertext,enabled,revision FROM voip_connections WHERE id=$1 AND owner_id=$2", [body.id,owner]);
      const c = r.rows[0]; if (!c) return reply({ error: "Connection not found" }, 404);
      if (!c.enabled) return reply({ error: "Enable the connection before testing" }, 409);
      let status = "FAILED", message = "VICIdial verification failed. Check HTTPS access, API credentials and permissions.";
      try { const result = await testVicidial(c.server_url,c.username,decryptCredential(c.secret_ciphertext)); status = result.status; message = result.message; } catch { /* Never expose raw upstream bodies, URLs with credentials, or errors. */ }
      const result = await client.query(`UPDATE voip_connections SET status=$1,status_message=$2,last_tested_at=NOW() WHERE id=$3 AND owner_id=$4 AND revision=$5 RETURNING ${publicColumns}`, [status,message,c.id,owner,c.revision]);
      if (!result.rows[0]) return reply({ error: "Configuration changed during verification. Test it again." }, 409);
      return reply({ connection: result.rows[0], verified: status === "CONNECTED" });
    }
    const p = routing.safeParse(body); if (!p.success) return reply({ error: p.error.issues[0].message }, 400);
    const v = p.data;
    const result = await client.query(`INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction,campaign_id,inbound_did,in_group,routing_destination)
      SELECT $2,$1,a.id,c.id,$5,$6,$7,$8,$9 FROM agents a JOIN voip_connections c ON c.id=$4 AND c.owner_id=$1
      WHERE a.id=$3 AND a.role='AGENT' AND ${portal==="admin"?controllerAgentSQL:"EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$1)"}
      ON CONFLICT(owner_id,agent_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,direction=EXCLUDED.direction,campaign_id=EXCLUDED.campaign_id,inbound_did=EXCLUDED.inbound_did,in_group=EXCLUDED.in_group,routing_destination=EXCLUDED.routing_destination,updated_at=NOW() RETURNING id`,
      [owner,randomUUID(),v.agentId,v.connectionId,v.direction,v.campaignId,v.inboundDid,v.inGroup,v.routingDestination]);
    if (!result.rows[0]) return reply({ error: "Owned agent and connection are required" }, 404);
    return reply({ saved: true, mediaStatus: "NOT_CONFIGURED" });
  } catch { return reply({ error: "Unable to save or verify VoIP configuration" }, 503); }
}
