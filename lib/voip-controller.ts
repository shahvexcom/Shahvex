import { isSameRequestOrigin } from "./request-origin";
import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db } from "./database";
import { ADMIN_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "./session";
import { encryptCredential, decryptCredential } from "./credential-crypto";
import { testVicidial, readVicidialVersion, vicidialURL } from "./vicidial";
import { vicidialLiveConfig, missingVicidialSetup } from "./vicidial-config";
import { requestBridge } from "./vicidial-bridge";
type Portal = "admin" | "bpo";
const connection = z.object({ action: z.literal("save"), id: z.string().max(100).optional(), name: z.string().trim().min(2).max(80), serverUrl: z.string().max(500), username: z.string().trim().min(2).max(20).regex(/^[\w-]+$/), secret: z.string().min(1).max(2000).optional(), method: z.literal("NON_AGENT_API"), enabled: z.boolean(), liveConfig: vicidialLiveConfig.omit({ bridgeUrl: true, directAudioMode: true, directAudioLines: true }).strip().optional(), recordingSecret: z.string().min(1).max(2000).optional() });
const routing = z.object({ action: z.literal("assign"), agentId: z.string().max(100), connectionId: z.string().max(100), direction: z.enum(["INBOUND","OUTBOUND"]), campaignId: z.string().trim().max(80), inboundDid: z.string().trim().max(80), inGroup: z.string().trim().max(80), routingDestination: z.string().trim().max(160) }).refine(v => v.direction === "OUTBOUND" ? Boolean(v.campaignId) : Boolean(v.inboundDid || v.inGroup || v.routingDestination), { message: "Specify an outbound campaign or an inbound routing destination" });
const publicColumns = `id,name,server_url,username,method,enabled,status,last_tested_at,status_message,revision,updated_at,live_config,media_verified_at,(bridge_secret_ciphertext IS NOT NULL) AS "hasBridgeSecret"`;
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const controllerAgentSQL = `(a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) AND NOT EXISTS (SELECT 1 FROM admin_agent_owners o JOIN agents tenant ON tenant.id=o.owner_id WHERE o.agent_id=a.id AND tenant.role='BPO'))`;
export const ownedAgentSQL = `(EXISTS (SELECT 1 FROM admin_agent_owners o WHERE o.agent_id=a.id AND o.owner_id=$1 AND o.verified=TRUE) OR EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$1))`;
function bridgeDefaults() {
  const secret = process.env.SHAHVEX_VICIDIAL_BRIDGE_SECRET;
  try {
    const url = new URL(process.env.SHAHVEX_VICIDIAL_BRIDGE_URL || "");
    vicidialURL(url.origin);
    if (url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && secret && secret.length >= 32 && secret.length <= 2000) {
      return { url: url.origin, secret };
    }
  } catch { /* Report missing server configuration without exposing credentials. */ }
  return null;
}
type ConnectionInput = z.infer<typeof connection>;
async function saveLiveSettings(client: { query: (sql: string, args: unknown[]) => Promise<{rows: Record<string, unknown>[]}> }, id: string, owner: string, v: ConnectionInput, bridge: ReturnType<typeof bridgeDefaults>) {
  if (!v.liveConfig && !v.recordingSecret && !bridge) return;
  const result = await client.query(`UPDATE voip_connections SET
    live_config=COALESCE(live_config,'{}'::jsonb) || $1::jsonb ||
      CASE WHEN $1::jsonb ? 'remoteUsers' THEN jsonb_build_object('remoteUsers', (
        SELECT ($1::jsonb->'remoteUsers') || COALESCE(jsonb_agg(DISTINCT line->>'remoteUser'),'[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(live_config->'directAudioLines','[]'::jsonb)) line
        WHERE NOT (($1::jsonb->'remoteUsers') ? (line->>'remoteUser'))
      )) ELSE '{}'::jsonb END ||
      CASE WHEN $6::text IS NOT NULL AND (NULLIF(live_config->>'bridgeUrl','') IS NULL OR bridge_secret_ciphertext IS NULL)
        THEN jsonb_build_object('bridgeUrl',$6::text) ELSE '{}'::jsonb END,
    bridge_secret_ciphertext=CASE WHEN $6::text IS NOT NULL AND (NULLIF(live_config->>'bridgeUrl','') IS NULL OR bridge_secret_ciphertext IS NULL)
      THEN $2 ELSE bridge_secret_ciphertext END,
    recording_secret_ciphertext=COALESCE($5,recording_secret_ciphertext),media_verified_at=NULL
    WHERE id=$3 AND owner_id=$4 AND deleted_at IS NULL RETURNING ${publicColumns}`, [
    JSON.stringify(v.liveConfig || {}), bridge ? encryptCredential(bridge.secret) : null,
    id, owner, v.recordingSecret ? encryptCredential(v.recordingSecret) : null, bridge?.url ?? null,
  ]);
  return result.rows[0];
}
export const agentRouteFields = z.object({
  connectionId: z.string().min(1).max(100),
  remoteUser: z.string().trim().regex(/^[\w-]{2,20}$/),
  prefix: z.string().trim().toLowerCase().regex(/^[0-9a-f]{4}$/),
});
const directRoute = agentRouteFields.extend({ agentId: z.string().min(1).max(100) });
const bpoRouteScope = `JOIN agents tenant ON tenant.id=c.owner_id AND tenant.role='BPO' AND tenant.status='APPROVED' AND tenant.deleted_at IS NULL
  JOIN bpo_created_agents b ON b.bpo_id=tenant.id
  JOIN agents a ON a.id=b.agent_id AND a.role='AGENT' AND a.deleted_at IS NULL`;
async function canManageBpoRoutes(client: Awaited<ReturnType<typeof db>>, owner: string) {
  const result = await client.query(`SELECT 1 FROM agents WHERE id=$1 AND role='ADMIN' AND status='APPROVED'
    AND (admin_role='SUPER_ADMIN' OR admin_permissions ? 'voip')`, [owner]);
  return Boolean(result.rowCount);
}
async function saveDirectRoute(client: Awaited<ReturnType<typeof db>>, body: unknown, portal: Portal, owner: string) {
  const parsed = directRoute.safeParse(body);
  if (!parsed.success) return reply({ error: "Enter a valid Remote Agent ID and four-character extension route." }, 400);
  const route = parsed.data;
  const crossTenant = portal === "admin" && await canManageBpoRoutes(client, owner);
  const tx = await client.connect();
  let committed = false;
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`vicidial:${route.connectionId}`]);
    const eligible = await tx.query(`SELECT c.id,c.live_config FROM voip_connections c
      JOIN agents candidate ON candidate.id=$2 AND candidate.role='AGENT' AND candidate.deleted_at IS NULL
      WHERE c.id=$1 AND c.deleted_at IS NULL AND (
        (c.owner_id=$3 AND EXISTS(SELECT 1 FROM agents a WHERE a.id=candidate.id AND ${portal === "admin" ? controllerAgentSQL : "EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$3)"}))
        OR ($4 AND EXISTS(SELECT 1 FROM agents tenant JOIN bpo_created_agents b ON b.bpo_id=tenant.id
          WHERE tenant.id=c.owner_id AND tenant.role='BPO' AND tenant.status='APPROVED' AND tenant.deleted_at IS NULL AND b.agent_id=candidate.id))
      ) FOR UPDATE OF c`, [route.connectionId, route.agentId, owner, crossTenant]);
    const c = eligible.rows[0];
    if (!c) return reply({ error: "Select an agent and a saved connection in the same workspace." }, 404);
    const failure = await writeAgentRoute(tx, c, route);
    if (failure) return reply({ error: failure.error }, failure.status);
    await tx.query("COMMIT");
    committed = true;
    return reply({ saved: true, message: "Agent route saved." });
  } finally {
    try { if (!committed) await tx.query("ROLLBACK"); } finally { tx.release(); }
  }
}
/** Caller checks ownership and holds the connection lock within its transaction. */
export async function writeAgentRoute(tx: Pick<PoolClient, "query">, c: { id: string; live_config: unknown }, route: z.infer<typeof directRoute>) {
  const live = vicidialLiveConfig.safeParse(c.live_config);
  if (!live.success) return { error: "The connection has invalid live calling settings.", status: 400 };
  const current = live.data.directAudioLines.find(line => line.agentId === route.agentId);
  if (live.data.directAudioMode && current?.prefix === route.prefix && current.remoteUser === route.remoteUser && live.data.remoteUsers.includes(route.remoteUser)) {
    return null;
  }
  const active = await tx.query(`SELECT 1 FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id
    WHERE p.connection_id=$1 UNION ALL SELECT 1 FROM agent_calls WHERE voip_connection_id=$1
    AND status IN ('INITIATED','RINGING','ANSWERED') LIMIT 1`, [c.id]);
  if (active.rowCount) return { error: "Stop this connection’s queues and let active calls finish before changing agent routes.", status: 409 };
  const lines = live.data.directAudioLines.filter(line => line.agentId !== route.agentId);
  if (lines.some(line => line.prefix === route.prefix || line.remoteUser === route.remoteUser)) {
    return { error: "That Remote Agent ID or extension already belongs to another agent on this connection.", status: 409 };
  }
  const updated = vicidialLiveConfig.safeParse({
    ...live.data,
    directAudioMode: true,
    directAudioLines: [...lines, { agentId: route.agentId, prefix: route.prefix, remoteUser: route.remoteUser }],
    remoteUsers: [...new Set([...live.data.remoteUsers.filter(user => user !== current?.remoteUser || lines.some(line => line.remoteUser === user)), route.remoteUser])],
  });
  if (!updated.success) return { error: "This connection has reached its agent route limit.", status: 409 };
  await tx.query("UPDATE voip_connections SET live_config=$2::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$1",
    [c.id, JSON.stringify(updated.data)]);
  return null;
}
export async function principal(portal: Portal) {
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
      client.query(`SELECT ${publicColumns} FROM voip_connections WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [owner]),
      client.query("SELECT id,agent_id,connection_id,direction,campaign_id,inbound_did,in_group,routing_destination,updated_at FROM voip_agent_assignments WHERE owner_id=$1 AND EXISTS(SELECT 1 FROM agents a WHERE a.id=agent_id AND a.deleted_at IS NULL)", [owner]),
      portal === "admin" ? client.query(`SELECT a.id,a.name,a.status FROM agents a WHERE a.role='AGENT' AND ${controllerAgentSQL} ORDER BY a.name`) : client.query("SELECT a.id,a.name,a.status FROM agents a JOIN bpo_created_agents b ON b.agent_id=a.id WHERE b.bpo_id=$1 AND a.deleted_at IS NULL ORDER BY a.name",[owner]),
    ]);
    const bridge = bridgeDefaults();
    const bpoRoutes = portal === "admin" && new URL(_request.url).searchParams.has("bpoRoutes") && await canManageBpoRoutes(client, owner)
      ? (await client.query(`SELECT c.id AS "connectionId", c.name AS "connectionName", tenant.name AS "workspaceName",
          a.id AS "agentId", a.name AS "agentName", line->>'remoteUser' AS "remoteUser", line->>'prefix' AS prefix
        FROM voip_connections c ${bpoRouteScope}
        LEFT JOIN LATERAL (SELECT item AS line FROM jsonb_array_elements(COALESCE(c.live_config->'directAudioLines','[]'::jsonb)) item
          WHERE item->>'agentId'=a.id LIMIT 1) mapping ON TRUE
        WHERE c.deleted_at IS NULL ORDER BY tenant.name,c.name,a.name`)).rows : [];
    return reply({ connections: connections.rows.map(c => ({ ...c, hasSecret: true })), assignments: assignments.rows, agents: agents.rows,
      bridgeDefaults: { url: bridge?.url ?? "", configured: Boolean(bridge) }, bpoRoutes });
  } catch { return reply({ error: "Unable to load VoIP configuration" }, 503); }
}
export async function postVoip(request: Request, portal: Portal) {
  try {
    const owner = await principal(portal); if (!owner) return reply({ error: "VoIP access is not authorized" }, 403);
    if (!isSameRequestOrigin(request)) return reply({ error: "Same-origin request required" }, 403);
    const raw = await request.text(); if (raw.length > 12000) return reply({ error: "Request too large" }, 413);
    const body = JSON.parse(raw), client = await db();
    if (body.action === "save-direct-route") return await saveDirectRoute(client, body, portal, owner);
    if(['disable','enable','delete'].includes(body.action)){
      const c=(await client.query('SELECT id FROM voip_connections WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[body.id,owner])).rows[0];if(!c)return reply({error:'Connection not found'},404);
      if(body.action==='enable'){await client.query("UPDATE voip_connections SET enabled=TRUE,status='NOT_TESTED',media_verified_at=NULL,updated_at=NOW() WHERE id=$1 AND owner_id=$2",[c.id,owner]);return reply({saved:true,message:'Connection enabled. Verify API and audio bridge before starting intake.'});}
      await client.query("UPDATE voip_connections SET enabled=FALSE,deleted_at=CASE WHEN $3 THEN NOW() ELSE deleted_at END,updated_at=NOW() WHERE id=$1 AND owner_id=$2",[c.id,owner,body.action==='delete']);
      await client.query("UPDATE campaign_definitions SET intake_state='STOPPED' WHERE connection_id=$1 AND owner_id=$2",[c.id,owner]);
      const members=await client.query('SELECT q.agent_id FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id WHERE p.connection_id=$1',[c.id]);let failed=0;
      for(const a of members.rows)try{await (await import('./vicidial-live')).stopVicidialAgent(a.agent_id);}catch{failed++;}
      return reply({saved:true,message:`Connection ${body.action==='delete'?'deleted':'disabled'}.${failed?' Native intake shutdown needs engineer verification.':''}`},failed?207:200);
    }
    if (["save","save-assigned"].includes(body.action) && typeof body.id === "string" && body.id) {
      const active=await client.query(`SELECT q.agent_id FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id JOIN voip_connections c ON c.id=p.connection_id WHERE c.id=$1 AND c.owner_id=$2 LIMIT 1`,[body.id,owner]);
      if(active.rows.length)return reply({error:"Stop this connection's VICIdial queues before changing its credentials, routing or live settings."},409);
    }
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
      const bridge = bridgeDefaults();
      if (!v.id && v.liveConfig?.enabled && !bridge) return reply({ error: "The website audio bridge defaults need server configuration." }, 503);
      const tx=await client.connect();
      try {
        await tx.query("BEGIN");
        const valid=await tx.query(`SELECT a.id FROM agents a WHERE a.id=ANY($1::text[]) AND a.role='AGENT' AND ${portal==="admin"?controllerAgentSQL:"EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$2)"} FOR UPDATE OF a`,portal==="admin"?[agentIds]:[agentIds,owner]);
        if(valid.rowCount!==agentIds.length){await tx.query("ROLLBACK");return reply({error:"Only controller agents can be assigned to this connection"},400);}
        const id=v.id||randomUUID();
        const saved=v.id?await tx.query(`UPDATE voip_connections SET name=$1,server_url=$2,username=$3,secret_ciphertext=COALESCE($4,secret_ciphertext),method=$5,enabled=$6,status='NOT_TESTED',status_message='',last_tested_at=NULL,revision=revision+1,updated_at=NOW() WHERE id=$7 AND owner_id=$8 AND deleted_at IS NULL RETURNING ${publicColumns}`,[v.name,url,v.username,v.secret?encryptCredential(v.secret):null,v.method,v.enabled,id,owner]):await tx.query(`INSERT INTO voip_connections(id,owner_id,name,server_url,username,secret_ciphertext,method,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${publicColumns}`,[id,owner,v.name,url,v.username,encryptCredential(v.secret!),v.method,v.enabled]);
        if(!saved.rows[0]){await tx.query("ROLLBACK");return reply({error:"Connection not found"},404);}
        const configured = await saveLiveSettings(tx,id,owner,v,bridge);
        await tx.query("DELETE FROM voip_agent_assignments WHERE owner_id=$1 AND EXISTS(SELECT 1 FROM agents a WHERE a.id=agent_id AND a.deleted_at IS NULL) AND connection_id=$2 AND NOT(agent_id=ANY($3::text[]))",[owner,id,agentIds]);
        for(const agentId of agentIds) await tx.query(`INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction,campaign_id,inbound_did,in_group,routing_destination) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,agent_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,direction=EXCLUDED.direction,campaign_id=EXCLUDED.campaign_id,inbound_did=EXCLUDED.inbound_did,in_group=EXCLUDED.in_group,routing_destination=EXCLUDED.routing_destination,updated_at=NOW()`,[randomUUID(),owner,agentId,id,r.direction,r.campaignId,r.inboundDid,r.inGroup,r.routingDestination]);
        await tx.query("COMMIT");return reply({connection:configured ?? saved.rows[0],saved:true},v.id?200:201);
      } catch(error) {await tx.query("ROLLBACK");throw error;} finally {tx.release();}
    }
    if (body.action === "save") {
      const p = connection.safeParse(body); if (!p.success) return reply({ error: p.error.issues[0].message }, 400);
      const v = p.data;
      const bridge = bridgeDefaults();
      if (v.liveConfig?.enabled) {
        const existing = v.id ? (await client.query('SELECT live_config,bridge_secret_ciphertext FROM voip_connections WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[v.id,owner])).rows[0] : null;
        const savedBridge = Boolean(existing?.live_config?.bridgeUrl && existing?.bridge_secret_ciphertext);
        if (!savedBridge && !bridge) return reply({ error: "The website audio bridge defaults need server configuration." }, 503);
        const missing = missingVicidialSetup({ ...v.liveConfig, bridgeUrl: savedBridge ? existing.live_config.bridgeUrl : bridge?.url }, true);
        if (missing.length) return reply({ error: `Complete the AI calling connection: ${missing.join(', ')}` }, 400);
      }
      let serverUrl: string;
      try { serverUrl = vicidialURL(v.serverUrl).href; } catch (e) { return reply({ error: e instanceof Error ? e.message : "Invalid server URL" }, 400); }
      if (!process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.AUTH_SECRET) return reply({ error: "Server credential encryption key is not configured" }, 503);
      if (!v.id && !v.secret) return reply({ error: "API secret is required for a new connection" }, 400);
      const id = v.id || randomUUID();
      const save = async (target: Pick<typeof client, "query">) => {
        const result = v.id
          ? await target.query(`UPDATE voip_connections SET name=$1,server_url=$2,username=$3,secret_ciphertext=COALESCE($4,secret_ciphertext),method=$5,enabled=$6,
            status='NOT_TESTED',status_message='',last_tested_at=NULL,revision=revision+1,updated_at=NOW() WHERE id=$7 AND owner_id=$8 AND deleted_at IS NULL RETURNING ${publicColumns}`,
            [v.name,serverUrl,v.username,v.secret ? encryptCredential(v.secret) : null,v.method,v.enabled,id,owner])
          : await target.query(`INSERT INTO voip_connections(id,owner_id,name,server_url,username,secret_ciphertext,method,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${publicColumns}`,
            [id,owner,v.name,serverUrl,v.username,encryptCredential(v.secret!),v.method,v.enabled]);
        if (!result.rows[0]) return reply({ error: "Connection not found" }, 404);
        const configured = await saveLiveSettings(target,result.rows[0].id,owner,v,bridge);
        return reply({ connection: configured ?? result.rows[0] }, v.id ? 200 : 201);
      };
      if (!v.liveConfig && !v.recordingSecret && !bridge) return await save(client);
      const tx = await client.connect();
      try {
        await tx.query("BEGIN");
        if (v.id) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`vicidial:${id}`]);
        const result = await save(tx);
        await tx.query("COMMIT");
        return result;
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally { tx.release(); }
    }
    if (body.action === "test-live") {
      const result = await client.query("SELECT id,live_config,bridge_secret_ciphertext,enabled,status FROM voip_connections WHERE id=$1 AND owner_id=$2", [body.id,owner]);
      const c = result.rows[0]; if (!c) return reply({error:"Connection not found"},404);
      const missing = missingVicidialSetup(c.live_config,Boolean(c.bridge_secret_ciphertext));
      if (!c.enabled || c.status !== "CONNECTED" || missing.length) return reply({error:missing.length ? missing.join(", ") : "Verify the enabled dialer API first"},409);
      const config = vicidialLiveConfig.parse(c.live_config);
      const health = await requestBridge(config.bridgeUrl,decryptCredential(c.bridge_secret_ciphertext),"/health");
      if (health.testOnly === true) return reply({error:"This is a local-test bridge. Select the production campaign bridge before enabling VICIdial intake."},409);
      if (health.protocol !== "shahvex-vicidial-v1" || health.audioSocket !== true || health.sharedTester !== true || health.aiOnlyRecording !== true || health.humanAnswerEvents !== true) return reply({error:"Update the audio bridge: shared testing, AI-only recordings and human-answer events are required"},409);
      await client.query("UPDATE voip_connections SET media_verified_at=NOW() WHERE id=$1 AND owner_id=$2",[c.id,owner]);
      return reply({saved:true,message:"Audio bridge reachable. A supervised answered call is still required to verify the Asterisk route, recordings and transfer."});
    }
    if (body.action === "test") {
      if (typeof body.id !== "string") return reply({ error: "Connection ID required" }, 400);
      const r = await client.query("SELECT id,server_url,username,secret_ciphertext,enabled,revision FROM voip_connections WHERE id=$1 AND owner_id=$2", [body.id,owner]);
      const c = r.rows[0]; if (!c) return reply({ error: "Connection not found" }, 404);
      if (!c.enabled) return reply({ error: "Enable the connection before testing" }, 409);
      let apiVersion="";
      let status = "FAILED", message = "VICIdial verification failed. Check HTTPS access, API credentials and permissions.";
      try { const result = await testVicidial(c.server_url,c.username,decryptCredential(c.secret_ciphertext)); status = result.status; message = result.message; try{apiVersion=await readVicidialVersion(c.server_url,c.username,decryptCredential(c.secret_ciphertext));}catch{message+=" API version unverified; engineer review required.";} } catch { /* Never expose raw upstream bodies, URLs with credentials, or errors. */ }
      const result = await client.query(`UPDATE voip_connections SET status=$1,status_message=$2,last_tested_at=NOW(),api_version=$6 WHERE id=$3 AND owner_id=$4 AND revision=$5 RETURNING ${publicColumns}`, [status,message,c.id,owner,c.revision,apiVersion]);
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
