import { isSameRequestOrigin } from "@/lib/request-origin";
import { campaignSettings } from "@/lib/campaign-config";
import { saveAgentCampaign, saveAgentCampaignPreference } from "@/lib/agent-campaign-assignment";
import { stopVicidialAgent } from "@/lib/vicidial-live";
import { localVoices } from "@/lib/agent-test";
import { conversationStyles } from "@/lib/agent-script-details";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const agentFields = z.object({
  change_campaign_assignment:z.boolean().optional(),
  preferred_category_id:z.string().uuid().or(z.literal('')).optional(),
  preferred_campaign_id:z.string().regex(/^[\w-]{0,80}$/).optional(),
  company_name:z.string().max(100).optional(),
  campaign_definition_id:z.string().uuid().or(z.literal('')).optional(),
  conversation_config:campaignSettings.optional(),
  agent_script:z.string().max(16000).optional(),
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  accent: z.string().trim().max(100),
  local_voice_id: z.string().min(1).max(64).optional(),
  conversation_style: z.enum(conversationStyles).optional(),
  speaks_first: z.enum(["ai","customer"]).optional(),
  language: z.literal("English").optional(),
  avatar_url: z.string().url().max(500).or(z.literal("")).or(z.string().regex(/^\/avatars\/agents\/[a-z0-9-]+\.svg$/)),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]),
  call_limit_minutes: z.number().int().min(0).max(100000),
  daily_call_limit: z.number().int().min(1).max(100000),
});
const createSchema = agentFields.extend({local_voice_id:z.string().min(1).max(64),password: z.string().min(8).max(128) });
const updateSchema = agentFields.extend({ id: z.string().min(1), password: z.string().min(8).max(128).optional().or(z.literal("")) });
const bulkApproveSchema = z.object({ action: z.literal("bulk-approve"), ids: z.array(z.string().min(1)).min(1).max(1000) });

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

const agentQuery = `SELECT (SELECT line->>'remoteUser' FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vc.live_config->'directAudioLines','[]'::jsonb)) line WHERE va.agent_id=a.id AND line->>'agentId'=a.id LIMIT 1) remote_user,(SELECT line->>'prefix' FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vc.live_config->'directAudioLines','[]'::jsonb)) line WHERE va.agent_id=a.id AND line->>'agentId'=a.id LIMIT 1) extension_route,COALESCE((SELECT p.category_id FROM agent_campaign_preferences p WHERE p.agent_id=a.id),'') preferred_category_id,
 COALESCE((SELECT p.external_campaign_id FROM agent_campaign_preferences p WHERE p.agent_id=a.id),'') preferred_campaign_id,
 (SELECT k.name FROM agent_campaign_preferences p JOIN campaign_categories k ON k.id=p.category_id WHERE p.agent_id=a.id) preferred_category_name,(SELECT d.name FROM campaign_agent_assignments x JOIN campaign_definitions d ON d.id=x.campaign_id WHERE x.agent_id=a.id) campaign_name,(SELECT d.external_campaign_id FROM campaign_agent_assignments x JOIN campaign_definitions d ON d.id=x.campaign_id WHERE x.agent_id=a.id) campaign_external_id,a.company_name,a.conversation_config,
  COALESCE((SELECT x.campaign_id FROM campaign_agent_assignments x WHERE x.agent_id=a.id),'') campaign_definition_id,
  (SELECT k.name FROM campaign_agent_assignments x JOIN campaign_definitions d ON d.id=x.campaign_id JOIN campaign_categories k ON k.id=d.category_id WHERE x.agent_id=a.id) category_name,a.id,a.name,a.username,a.gender,a.accent,a.local_voice_id,COALESCE((SELECT name FROM local_voice_registry v WHERE v.id=a.local_voice_id),'') local_voice_name,COALESCE(NULLIF(a.agent_script,''),(SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1),'') agent_script,a.conversation_style,a.speaks_first,a.language,a.status,COALESCE(a.avatar_url,'') avatar_url,
  COALESCE(a.call_limit_minutes,0) call_limit_minutes,a.daily_call_limit,a.created_at,
  (SELECT c.label FROM agent_credentials ac JOIN ai_credentials c ON c.id=ac.credential_id WHERE ac.agent_id=a.id AND ac.provider='GROQ') groq_credential_label,
  (SELECT c.label FROM agent_credentials ac JOIN ai_credentials c ON c.id=ac.credential_id WHERE ac.agent_id=a.id AND ac.provider='TELNYX') telnyx_credential_label,
  (SELECT COUNT(*)::int FROM agent_calls c WHERE c.agent_id=a.id AND c.call_type='LEAD') dialed_calls,
  (SELECT COUNT(*)::int FROM leads l WHERE l.agent_id=a.id) total_leads
  FROM agents a
  WHERE a.role='AGENT' AND a.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`;

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const result = await (await db()).query(`${agentQuery} ORDER BY a.created_at DESC`);
  return Response.json({ agents: result.rows });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid agent details." }, { status: 400 });
  const a = parsed.data, client = await (await db()).connect();
  try {
  const voice=(await localVoices(admin.agentId)).voices.find(v=>v.id===a.local_voice_id);
  if(!voice)return Response.json({message:"Select an active approved local voice."},{status:400});
  a.accent=voice.accent; a.gender=voice.gender.toUpperCase()==="MALE"?"MALE":voice.gender.toUpperCase()==="FEMALE"?"FEMALE":"OTHER";
    await client.query("BEGIN");
    const result = await client.query(`WITH created AS (INSERT INTO agents (id,name,username,password_hash,gender,accent,avatar_url,status,role,call_limit_minutes,daily_call_limit,approved_at,local_voice_id,agent_script,conversation_style,speaks_first,language)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AGENT',$9,$10,$11,$13,$14,$15,$16,'English') RETURNING id), owned AS (INSERT INTO admin_agent_owners(agent_id,owner_id,verified) SELECT id,$12,TRUE FROM created RETURNING agent_id) SELECT agent_id AS id FROM owned`, [randomUUID(), a.name, a.username, await hash(a.password, 12), a.gender, a.accent, a.avatar_url || null, a.status, a.call_limit_minutes || null, a.daily_call_limit, a.status === "APPROVED" ? new Date() : null, admin.agentId,a.local_voice_id,a.agent_script||"",a.conversation_style||"Professional",a.speaks_first||"customer"]);
    await client.query("UPDATE agents SET company_name=$1,conversation_config=$2::jsonb WHERE id=$3",[a.company_name||'',JSON.stringify(a.conversation_config||{}),result.rows[0].id]);
    await saveAgentCampaign(client,result.rows[0].id,admin.agentId,a.campaign_definition_id);
    await saveAgentCampaignPreference(client,result.rows[0].id,admin.agentId,a.preferred_category_id,a.preferred_campaign_id);
    await client.query('COMMIT');
    const agent = await client.query(`${agentQuery} AND a.id=$1`, [result.rows[0].id]);
    return Response.json({ message: "Agent created.", agent: agent.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    return Response.json({ message: error instanceof Error && /unique/i.test(error.message) ? "Name or username is already in use." : "Unable to create agent." }, { status: 400 });
  } finally {client.release();}
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const bulk = bulkApproveSchema.safeParse(body);
  if (bulk.success) {
    const result = await (await db()).query("UPDATE agents a SET status='APPROVED',approved_at=COALESCE(approved_at,NOW()),updated_at=NOW() WHERE a.role='AGENT' AND a.deleted_at IS NULL AND a.id=ANY($1::text[]) AND a.status <> 'APPROVED' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) RETURNING id", [bulk.data.ids]);
    return Response.json({ message: `${result.rowCount ?? 0} agent(s) approved.`, approvedIds: result.rows.map(row => row.id) });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid agent details." }, { status: 400 });
  const a = parsed.data, client = await (await db()).connect();
  try {
  if(a.local_voice_id){const voice=(await localVoices(admin.agentId)).voices.find(v=>v.id===a.local_voice_id);if(!voice)return Response.json({message:"Select an active approved local voice."},{status:400});a.accent=voice.accent;a.gender=voice.gender.toUpperCase()==="MALE"?"MALE":voice.gender.toUpperCase()==="FEMALE"?"FEMALE":"OTHER";}
    const existing = await client.query("SELECT password_hash,local_voice_id,conversation_style,speaks_first,status,(SELECT x.campaign_id FROM campaign_agent_assignments x WHERE x.agent_id=a.id) campaign_definition_id FROM agents a WHERE id=$1 AND deleted_at IS NULL AND role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [a.id]);
    if (!existing.rows[0]) return Response.json({ message: "Agent not found." }, { status: 404 });
    const previous=existing.rows[0];
    // Blank campaign values from older edit forms must never unassign an agent.
    const campaignChange=a.campaign_definition_id!==undefined&&(Boolean(a.campaign_definition_id)||a.change_campaign_assignment===true)&&a.campaign_definition_id!==(previous.campaign_definition_id||'');
    const callingChange=campaignChange||(['local_voice_id','conversation_style','speaks_first'] as const).some(key=>a[key]!==undefined&&a[key]!==previous[key])||(a.status!==previous.status&&a.status!=='APPROVED');
    if(callingChange)await stopVicidialAgent(a.id);
    await client.query('BEGIN');
    const updated = await client.query(`UPDATE agents a SET name=$1,username=$2,gender=$3,accent=$4,avatar_url=$5,status=$6::varchar,call_limit_minutes=$7,daily_call_limit=$8,password_hash=$9,local_voice_id=COALESCE($11,local_voice_id),agent_script=COALESCE($12,agent_script),conversation_style=COALESCE($13,conversation_style),speaks_first=COALESCE($14,speaks_first),language=COALESCE($15,language),approved_at=CASE WHEN $6::varchar='APPROVED' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,updated_at=NOW() WHERE id=$10 AND a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) RETURNING id,name,username,gender,accent,local_voice_id,agent_script,conversation_style,speaks_first,language,status,COALESCE(avatar_url,'') avatar_url,COALESCE(call_limit_minutes,0) call_limit_minutes,daily_call_limit`, [a.name, a.username, a.gender, a.accent, a.avatar_url || null, a.status, a.call_limit_minutes || null, a.daily_call_limit, a.password ? await hash(a.password, 12) : existing.rows[0].password_hash, a.id,a.local_voice_id??null,a.agent_script??null,a.conversation_style??null,a.speaks_first??null,a.language??null]);
    if (!updated.rows[0]) {await client.query("ROLLBACK");return Response.json({ message: "Agent not found." }, { status: 404 });}
    await client.query("UPDATE agents SET company_name=COALESCE($1,company_name),conversation_config=COALESCE($2::jsonb,conversation_config) WHERE id=$3",[a.company_name??null,a.conversation_config?JSON.stringify(a.conversation_config):null,a.id]);
    if(campaignChange)await saveAgentCampaign(client,a.id,admin.agentId,a.campaign_definition_id);
    await saveAgentCampaignPreference(client,a.id,admin.agentId,a.preferred_category_id,a.preferred_campaign_id);
    await client.query('COMMIT');
    const saved=await client.query(`${agentQuery} AND a.id=$1`,[a.id]);
    return Response.json({ message:'Agent updated.',agent:saved.rows[0] });
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    return Response.json({ message: error instanceof Error && /unique/i.test(error.message) ? "Name or username is already in use." : error instanceof Error && /active call|owned campaign|owned category|another owner/.test(error.message) ? error.message : "Unable to update agent. Please try again." }, { status: 400 });
  } finally {client.release();}
}

export async function DELETE(request:Request){
 if(!await requireAdmin())return Response.json({message:"Unauthenticated"},{status:401});
 if(!isSameRequestOrigin(request))return Response.json({message:"Same-origin request required"},{status:403});
 const parsed=z.object({ids:z.array(z.string().min(1).max(100)).min(1).max(1000)}).strict().safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({message:"Select one or more agents to delete."},{status:400});
 const ids=[...new Set(parsed.data.ids)],tx=await(await db()).connect();
 try{
  await tx.query('BEGIN');
  const found=await tx.query("SELECT a.id FROM agents a WHERE a.id=ANY($1::text[]) AND a.role='AGENT' AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) ORDER BY a.id FOR UPDATE OF a",[ids]);
  if(found.rows.length!==ids.length){await tx.query('ROLLBACK');return Response.json({message:"One or more selected agents are unavailable. Refresh and try again."},{status:404});}
  const active=await tx.query("SELECT agent_id FROM agent_calls WHERE agent_id=ANY($1::text[]) AND status IN ('INITIATED','RINGING','ANSWERED') UNION SELECT agent_id FROM ai_agent_runtime_states WHERE agent_id=ANY($1::text[]) AND call_id IS NOT NULL",[ids]);
  if(active.rows.length){await tx.query('ROLLBACK');return Response.json({message:"A selected agent has an active call. Finish that call before deleting.",activeAgentIds:active.rows.map(r=>r.agent_id)},{status:409});}
  for(const id of ids)await stopVicidialAgent(id,{disableAssignment:true});
  await tx.query("UPDATE agents SET deleted_at=NOW(),status='SUSPENDED',updated_at=NOW() WHERE id=ANY($1::text[])",[ids]);
  await tx.query('COMMIT');
  return Response.json({message:ids.length===1?"Agent deleted.":`${ids.length} agents deleted.`,deletedIds:ids});
 }catch{await tx.query('ROLLBACK');return Response.json({message:"Unable to delete selected agents. Check their calling connections and try again."},{status:503});}
 finally{tx.release();}
}
