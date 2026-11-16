import { isSameRequestOrigin } from "./request-origin";
import { saveAgentCampaign } from "./agent-campaign-assignment";
import { missingVicidialSetup } from "./vicidial-config";
import { extractCampaignScript } from "./campaign-script-extraction";
import { randomUUID,createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./database";
import { principal,controllerAgentSQL } from "./voip-controller";
import { campaignSettings,parseVicidialTable } from "./campaign-config";
import { decryptCredential } from "./credential-crypto";
import { vicidialRequest } from "./vicidial";

type Portal='admin'|'bpo';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const uuid=z.string().uuid();
const category=z.object({action:z.literal('save-category'),id:uuid.optional(),name:z.string().trim().min(1).max(80),description:z.string().max(3000).default('')});
const definition=z.object({action:z.literal('save-campaign'),id:uuid.optional(),name:z.string().trim().min(1).max(100),categoryId:uuid.nullable().default(null),connectionId:uuid,externalId:z.string().regex(/^[\w-]{2,80}$/),enabled:z.boolean(),script:z.string().trim().min(1).max(16000),transferInGroup:z.string().regex(/^[\w-]{0,80}$/).default(''),settings:campaignSettings.optional(),agentIds:z.array(z.string().min(1).max(100)).max(1000).optional()});
const assignments=z.object({action:z.enum(['assign','unassign']),campaignId:uuid,agentIds:z.array(z.string().min(1).max(100)).min(1).max(1000)});
const control=z.object({action:z.enum(['validate','start','pause','stop']),campaignId:uuid});
const sync=z.object({action:z.enum(['sync-campaigns','disconnect']),connectionId:uuid});

export async function getCampaigns(_request:Request,portal:Portal){
 const owner=await principal(portal);if(!owner)return reply({error:'Campaign management is not authorized'},403);
 const pool=await db();
 const [categories,campaigns,agents,connections]=await Promise.all([
  pool.query('SELECT id,name,description FROM campaign_categories WHERE owner_id=$1 ORDER BY name',[owner]),
  pool.query(`SELECT d.*,CASE WHEN c.deleted_at IS NULL THEN c.name ELSE c.name||' (deleted)' END connection_name,k.name category_name,
   (SELECT COUNT(*)::int FROM campaign_agent_assignments x JOIN agents member ON member.id=x.agent_id AND member.deleted_at IS NULL WHERE x.campaign_id=d.id) total_agents,
   (SELECT COUNT(*)::int FROM campaign_agent_assignments x JOIN agents member ON member.id=x.agent_id AND member.deleted_at IS NULL
    JOIN voip_agent_assignments va ON va.agent_id=member.id AND va.connection_id=d.connection_id AND va.campaign_id=d.external_campaign_id
    WHERE x.campaign_id=d.id AND member.status='APPROVED' AND COALESCE(member.local_voice_id,'')<>'' AND c.enabled AND c.status='CONNECTED' AND c.media_verified_at IS NOT NULL
    AND BTRIM(d.script)<>'' AND (SELECT COUNT(*) FROM agent_calls ac WHERE ac.agent_id=member.id AND ac.created_at>=date_trunc('day',NOW()))<member.daily_call_limit
    AND NOT EXISTS(SELECT 1 FROM agent_calls ac WHERE ac.agent_id=member.id AND ac.status IN ('INITIATED','RINGING','ANSWERED'))
    AND NOT EXISTS(SELECT 1 FROM ai_agent_runtime_states rs WHERE rs.agent_id=member.id AND rs.call_id IS NOT NULL)
    AND (COALESCE(c.live_config->>'directAudioMode','false')<>'true' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.live_config->'directAudioLines','[]'::jsonb)) line WHERE line->>'agentId'=member.id))) ready_agents,
   (SELECT COUNT(*)::int FROM ai_agent_runtime_states r JOIN campaign_agent_assignments x ON x.agent_id=r.agent_id AND x.campaign_id=d.id AND x.enabled
    JOIN agents member ON member.id=r.agent_id AND member.deleted_at IS NULL AND member.status='APPROVED'
    JOIN vicidial_pool_agents q ON q.agent_id=r.agent_id AND q.ready WHERE r.campaign_id=d.id AND r.state='READY' AND r.call_id IS NULL) intake_agents,
   (SELECT COUNT(*)::int FROM ai_agent_runtime_states r WHERE r.campaign_id=d.id AND r.state IN ('BUSY','RESERVED','TRANSFERRING')) busy_agents
   FROM campaign_definitions d JOIN voip_connections c ON c.id=d.connection_id LEFT JOIN campaign_categories k ON k.id=d.category_id WHERE d.owner_id=$1 AND d.deleted_at IS NULL ORDER BY d.name`,[owner]),
  pool.query(`SELECT a.id,a.name,a.local_voice_id,a.language,p.category_id preferred_category_id,p.external_campaign_id preferred_campaign_id,x.campaign_id,x.enabled,r.state runtime_state,r.last_seen_at,r.last_error,
   r.call_id,coalesce((SELECT COUNT(*) FROM agent_calls ac WHERE ac.agent_id=a.id AND ac.status='COMPLETED'),0)::int completed_calls,
   coalesce((SELECT COUNT(*) FROM agent_calls ac WHERE ac.agent_id=a.id AND ac.transfer_status='ANSWERED'),0)::int completed_transfers
   FROM agents a LEFT JOIN agent_campaign_preferences p ON p.agent_id=a.id AND p.owner_id=$1 LEFT JOIN campaign_agent_assignments x ON x.agent_id=a.id LEFT JOIN ai_agent_runtime_states r ON r.agent_id=a.id
   WHERE a.role='AGENT' AND a.deleted_at IS NULL AND ${portal==='admin'?controllerAgentSQL:'EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$1)'} ORDER BY a.name`,[owner]),
  pool.query('SELECT id,name,enabled,status,api_version,asterisk_version,media_verified_at,last_sync_at,last_sync_error,last_heartbeat_at,last_human_event_at FROM voip_connections WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY name',[owner]),
 ]);
 return reply({categories:categories.rows,campaigns:campaigns.rows,agents:agents.rows,connections:connections.rows});
}

export async function postCampaigns(request:Request,portal:Portal){
 const owner=await principal(portal);if(!owner)return reply({error:'Campaign management is not authorized'},403);
 if(!isSameRequestOrigin(request))return reply({error:'Same-origin request required'},403);
 const raw=await request.text();if(raw.length>200000)return reply({error:'Request too large'},413);
 const value=JSON.parse(raw),pool=await db();
 if(value.action==='delete-category'&&uuid.safeParse(value.id).success){
  const tx=await pool.connect();try{await tx.query('BEGIN');
   const owned=await tx.query('SELECT id FROM campaign_categories WHERE id=$1 AND owner_id=$2 FOR UPDATE',[value.id,owner]);if(!owned.rows.length){await tx.query('ROLLBACK');return reply({error:'Category not found'},404);}
   await tx.query('UPDATE campaign_definitions SET category_id=NULL,updated_at=NOW() WHERE category_id=$1 AND owner_id=$2',[value.id,owner]);
   await tx.query('DELETE FROM campaign_categories WHERE id=$1 AND owner_id=$2',[value.id,owner]);await tx.query('COMMIT');return reply({saved:true,message:'Category removed. Campaigns and agents are preserved.'});
  }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
 }
 if(value.action==='delete-campaign'&&uuid.safeParse(value.campaignId).success){
  if(portal!=='admin')return reply({error:'Only the controller can delete campaigns'},403);
  const tx=await pool.connect();let campaign,ids:string[]=[];
  try{await tx.query('BEGIN');
   campaign=(await tx.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[value.campaignId,owner])).rows[0];
   if(!campaign){await tx.query('ROLLBACK');return reply({error:'Campaign not found'},404);}
   await tx.query("UPDATE campaign_definitions SET deleted_at=COALESCE(deleted_at,NOW()),enabled=FALSE,intake_state='STOPPED',last_error='Campaign removal in progress',updated_at=NOW() WHERE id=$1 AND owner_id=$2",[campaign.id,owner]);
   ids=(await tx.query('UPDATE campaign_agent_assignments SET enabled=FALSE WHERE campaign_id=$1 AND owner_id=$2 RETURNING agent_id',[campaign.id,owner])).rows.map(a=>a.agent_id);
   await tx.query('UPDATE vicidial_pool_agents SET ready=FALSE WHERE agent_id=ANY($1::text[])',[ids]);
   await tx.query('COMMIT');
  }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
  // Retain ownership bindings until native intake shutdown has been attempted.
  let pending=0;for(const id of ids)try{await (await import('./vicidial-live')).stopVicidialAgent(id);}catch{pending++;}
  const cleanup=await pool.connect();try{await cleanup.query('BEGIN');
   await cleanup.query('DELETE FROM voip_agent_assignments WHERE owner_id=$1 AND connection_id=$2 AND campaign_id=$3 AND agent_id=ANY($4::text[])',[owner,campaign.connection_id,campaign.external_campaign_id,ids]);
   await cleanup.query('DELETE FROM campaign_agent_assignments WHERE campaign_id=$1 AND owner_id=$2',[campaign.id,owner]);
   await cleanup.query("UPDATE ai_agent_runtime_states SET state='OFFLINE' WHERE agent_id=ANY($1::text[]) AND call_id IS NULL",[ids]);
   await cleanup.query('UPDATE campaign_definitions SET last_error=$1 WHERE id=$2 AND owner_id=$3',[pending?'Native intake shutdown needs verification':'',campaign.id,owner]);
   await cleanup.query('COMMIT');
  }catch(e){await cleanup.query('ROLLBACK');throw e;}finally{cleanup.release();}
  return reply({saved:true,message:`Campaign deleted. Agents and call history are preserved.${pending?' Native intake shutdown needs verification.':''}`},pending?207:200);
 }
 const cat=category.safeParse(value);
 if(cat.success){const v=cat.data;const result=v.id?await pool.query('UPDATE campaign_categories SET name=$1,description=$2,updated_at=NOW() WHERE id=$3 AND owner_id=$4 RETURNING id',[v.name,v.description,v.id,owner]):await pool.query('INSERT INTO campaign_categories(id,owner_id,name,description) VALUES($1,$2,$3,$4) RETURNING id',[randomUUID(),owner,v.name,v.description]);return result.rows[0]?reply({saved:true,id:result.rows[0].id}):reply({error:'Category not found'},404);}
 const save=definition.safeParse(value);
 if(save.success){const v=save.data;const connection=(await pool.query('SELECT id FROM voip_connections WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[v.connectionId,owner])).rows[0];if(!connection)return reply({error:'Owned connection required'},404);
  if(v.categoryId&&!(await pool.query('SELECT id FROM campaign_categories WHERE id=$1 AND owner_id=$2',[v.categoryId,owner])).rows.length)return reply({error:'Category not found'},404);
  const previous=v.id?(await pool.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[v.id,owner])).rows[0]:null;
  if(v.id&&!previous)return reply({error:'Campaign not found'},404);
  const extractionHash=createHash('sha256').update(v.script).digest('hex');
  const extracted=previous?.script===v.script&&previous.script_extraction_hash===extractionHash?campaignSettings.parse(previous.settings):await extractCampaignScript(owner,v.script);
  const settings={...extracted,leadFieldMap:previous?.settings?.leadFieldMap||{},commentLimit:previous?.settings?.commentLimit||255};
  if(v.id){const existing=(await pool.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[v.id,owner])).rows[0];if(!existing)return reply({error:'Campaign not found'},404);
   // Disable only remote intake; active calls retain their immutable snapshots.
   const members=await pool.query('SELECT agent_id FROM campaign_agent_assignments WHERE campaign_id=$1',[v.id]);for(const a of members.rows)await (await import('./vicidial-live')).stopVicidialAgent(a.agent_id);
   await pool.query(`UPDATE campaign_definitions SET name=$1,category_id=$2,connection_id=$3,external_campaign_id=$4::varchar(80),enabled=$5,script=$6,settings=$7::jsonb,transfer_in_group=$8,script_extraction_hash=$11,validated_at=CASE WHEN connection_id=$3 AND external_campaign_id=$4::varchar(80) THEN validated_at ELSE NULL END,updated_at=NOW() WHERE id=$9 AND owner_id=$10`,[v.name,v.categoryId,v.connectionId,v.externalId,v.enabled,v.script,JSON.stringify(settings),v.transferInGroup,v.id,owner,extractionHash]);
   await pool.query("UPDATE voip_agent_assignments SET connection_id=$1,campaign_id=$2,updated_at=NOW() WHERE agent_id IN (SELECT agent_id FROM campaign_agent_assignments WHERE campaign_id=$3) AND owner_id=$4",[v.connectionId,v.externalId,v.id,owner]);
   return reply({saved:true,id:v.id,message:'Campaign saved. Active conversations keep their existing script; intake resumes through reconciliation.'});
  }
  const ids=[...new Set(v.agentIds||[])];
  if(ids.length){const allowed=await pool.query(`SELECT a.id FROM agents a WHERE a.id=ANY($1::text[]) AND a.role='AGENT' AND ${portal==='admin'?controllerAgentSQL:'EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$2)'}`,portal==='admin'?[ids]:[ids,owner]);if(allowed.rows.length!==ids.length)return reply({error:'Only accessible agents may be assigned'},403);}
  if(ids.length&&(await pool.query('SELECT agent_id FROM campaign_agent_assignments WHERE agent_id=ANY($1::text[])',[ids])).rows.length)return reply({error:'An agent can belong to only one campaign. Remove its current assignment first.'},409);
  for(const agentId of ids)await (await import('./vicidial-live')).stopVicidialAgent(agentId);
  const tx=await pool.connect();try{await tx.query('BEGIN');
  const id=randomUUID();const created=await tx.query('INSERT INTO campaign_definitions(id,owner_id,category_id,name,connection_id,external_campaign_id,enabled,script,settings,transfer_in_group,script_extraction_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT(connection_id,external_campaign_id) DO UPDATE SET name=EXCLUDED.name,category_id=EXCLUDED.category_id,enabled=EXCLUDED.enabled,script=EXCLUDED.script,settings=EXCLUDED.settings,transfer_in_group=EXCLUDED.transfer_in_group,script_extraction_hash=EXCLUDED.script_extraction_hash,deleted_at=NULL,intake_state=\'STOPPED\',validated_at=NULL,updated_at=NOW() WHERE campaign_definitions.deleted_at IS NOT NULL AND campaign_definitions.last_error=\'\' AND campaign_definitions.owner_id=EXCLUDED.owner_id RETURNING id',[id,owner,v.categoryId,v.name,v.connectionId,v.externalId,v.enabled,v.script,JSON.stringify(settings),v.transferInGroup,extractionHash]);if(created.rowCount===0){await tx.query('ROLLBACK');return reply({error:'This campaign mapping already exists. Use Edit campaign.'},409);}const savedId=created.rows[0].id;for(const agentId of ids)await saveAgentCampaign(tx,agentId,owner,savedId);await tx.query('COMMIT');return reply({saved:true,id:savedId},201);
  }catch(e){await tx.query('ROLLBACK');if(e instanceof Error&&e.message.startsWith('An agent can belong to only one campaign.'))return reply({error:e.message},409);throw e;}finally{tx.release();}
 }
 const assign=assignments.safeParse(value);
 if(assign.success){const v=assign.data,d=(await pool.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[v.campaignId,owner])).rows[0];if(!d)return reply({error:'Campaign not found'},404);
  const ids=[...new Set(v.agentIds)],allowed=await pool.query(`SELECT a.id FROM agents a WHERE a.id=ANY($1::text[]) AND a.role='AGENT' AND ${portal==='admin'?controllerAgentSQL:'EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$2)'}`,portal==='admin'?[ids]:[ids,owner]);if(allowed.rows.length!==ids.length)return reply({error:'Only accessible agents may be assigned'},403);
  if(v.action==='assign'){const conflicts=await pool.query('SELECT agent_id FROM campaign_agent_assignments WHERE agent_id=ANY($1::text[]) AND campaign_id<>$2',[ids,d.id]);if(conflicts.rows.length)return reply({error:'An agent can belong to only one campaign. Remove its current assignment first.'},409);}
  for(const id of ids)await (await import('./vicidial-live')).stopVicidialAgent(id);
  const tx=await pool.connect();try{await tx.query('BEGIN');const current=await tx.query('SELECT id FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE',[d.id,owner]);if(!current.rows.length){await tx.query('ROLLBACK');return reply({error:'Campaign was deleted'},409);}await tx.query('SELECT id FROM agents WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[ids]);for(const id of ids){if(v.action==='unassign'){await tx.query('DELETE FROM campaign_agent_assignments WHERE agent_id=$1 AND campaign_id=$2 AND owner_id=$3',[id,d.id,owner]);await tx.query('DELETE FROM voip_agent_assignments WHERE agent_id=$1 AND connection_id=$2 AND campaign_id=$3 AND owner_id=$4',[id,d.connection_id,d.external_campaign_id,owner]);await tx.query("UPDATE ai_agent_runtime_states SET state='OFFLINE',updated_at=NOW() WHERE agent_id=$1 AND call_id IS NULL",[id]);}
   else{await saveAgentCampaign(tx,id,owner,d.id);}}
   await tx.query('COMMIT');}catch(e){await tx.query('ROLLBACK');if(e instanceof Error&&e.message.startsWith('An agent can belong to only one campaign.'))return reply({error:e.message},409);throw e;}finally{tx.release();}return reply({saved:true,message:'Assignment saved; active call snapshots are preserved.'});
 }
 const connectionAction=sync.safeParse(value);
 if(connectionAction.success){const v=connectionAction.data,c=(await pool.query('SELECT * FROM voip_connections WHERE id=$1 AND owner_id=$2',[v.connectionId,owner])).rows[0];if(!c)return reply({error:'Connection not found'},404);
  if(v.action==='disconnect'){const members=await pool.query('SELECT q.agent_id FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id WHERE p.connection_id=$1',[c.id]);for(const a of members.rows)await (await import('./vicidial-live')).stopVicidialAgent(a.agent_id);await pool.query("UPDATE voip_connections SET enabled=FALSE,status='DISCONNECTED',media_verified_at=NULL WHERE id=$1 AND owner_id=$2",[c.id,owner]);return reply({saved:true,message:'Remote intake disabled and integration disconnected. Active calls are preserved.'});}
  const rows=parseVicidialTable(await vicidialRequest(c.server_url,c.username,decryptCredential(c.secret_ciphertext),{function:'campaigns_list',stage:'pipe',header:'YES'}));
  if(rows.some(r=>!r.campaign_id))return reply({error:'Unsupported campaigns_list response; engineer verification required'},409);
  for(const r of rows)await pool.query(`INSERT INTO campaign_definitions(id,owner_id,name,connection_id,external_campaign_id,native_active,validated_at,last_sync_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT(connection_id,external_campaign_id) DO UPDATE SET native_active=EXCLUDED.native_active,validated_at=NOW(),last_sync_at=NOW(),last_error=''`,[randomUUID(),owner,r.campaign_name||r.campaign_id,c.id,r.campaign_id,r.active==='Y']);
  await pool.query("UPDATE voip_connections SET last_sync_at=NOW(),last_sync_error='' WHERE id=$1",[c.id]);return reply({saved:true,message:`${rows.length} real VICIdial campaign(s) synchronized.`});
 }
 const command=control.safeParse(value);
 if(command.success){const v=command.data,d=(await pool.query('SELECT d.*,c.server_url,c.username,c.secret_ciphertext,c.enabled connection_enabled,c.deleted_at connection_deleted_at,c.status connection_status,c.live_config,c.media_verified_at,c.bridge_secret_ciphertext FROM campaign_definitions d JOIN voip_connections c ON c.id=d.connection_id WHERE d.id=$1 AND d.owner_id=$2 AND d.deleted_at IS NULL',[v.campaignId,owner])).rows[0];if(!d)return reply({error:'Campaign not found'},404);
  if(v.action==='start'){
   if(!d.connection_enabled||d.connection_deleted_at||d.connection_status!=='CONNECTED')return reply({error:'Enable and test the campaign?s saved VICIdial connection first.'},409);
   const missing=missingVicidialSetup(d.live_config,Boolean(d.bridge_secret_ciphertext));
   if(!d.media_verified_at)missing.push('Test audio bridge');
   if(missing.length)return reply({error:`Complete the campaign?s calling connection: ${missing.join(', ')}`},409);
   if(!d.script?.trim())return reply({error:'Save the campaign script before starting calls.'},409);
  }
  const native=parseVicidialTable(await vicidialRequest(d.server_url,d.username,decryptCredential(d.secret_ciphertext),{function:'campaigns_list',campaign_id:d.external_campaign_id,stage:'pipe',header:'YES'})).find(r=>r.campaign_id===d.external_campaign_id);if(!native)return reply({error:'Exact VICIdial campaign not found; check server mapping and API permissions'},409);
  await pool.query('UPDATE campaign_definitions SET validated_at=NOW(),native_active=$1,last_sync_at=NOW(),last_error=\'\' WHERE id=$2',[native.active==='Y',d.id]);
  if(v.action==='validate')return reply({saved:true,message:`Exact external campaign verified (${native.active==='Y'?'active':'inactive'}).`});
  if(v.action==='start'&&(!d.enabled||native.active!=='Y'))return reply({error:'Enable this mapped campaign and activate it on VICIdial before starting AI intake'},409);
  const members=await pool.query(`SELECT x.agent_id,r.state runtime_state,r.call_id,q.ready FROM campaign_agent_assignments x JOIN agents member ON member.id=x.agent_id AND member.deleted_at IS NULL LEFT JOIN ai_agent_runtime_states r ON r.agent_id=x.agent_id LEFT JOIN vicidial_pool_agents q ON q.agent_id=x.agent_id WHERE x.campaign_id=$1 AND x.enabled=TRUE`,[d.id]);
  if(v.action==='start'&&!members.rows.length)return reply({error:'Assign at least one AI agent to this campaign before starting calls.'},409);
  const desired=v.action==='start'?'RUNNING':v.action==='pause'?'PAUSED':'STOPPED';await pool.query('UPDATE campaign_definitions SET intake_state=$1 WHERE id=$2 AND deleted_at IS NULL',[desired,d.id]);
  let confirmed=0,busyAgents=0;const failures:string[]=[];
  for(const a of members.rows){try{if(v.action==='start'&&a.call_id){busyAgents++;continue;}if(v.action==='start'&&a.ready&&a.runtime_state==='READY'){confirmed++;continue;}if(v.action==='start')await (await import('./vicidial-live')).startVicidialAgent(a.agent_id,portal==='bpo'?{bpoId:owner,dialingSource:'MANUAL'}:{});else await (await import('./vicidial-live')).stopVicidialAgent(a.agent_id);confirmed++;}catch{failures.push(a.agent_id);}}
  return reply({saved:true,scope:'AI_REMOTE_AGENT_INTAKE',confirmed,busyAgents,failed:failures,desired,message:v.action==='start'?`${confirmed} AI agent(s) ready for VICIdial campaign calls. ${busyAgents} already on a call. ${failures.length} pending/failed.`:`${confirmed} AI intake operation(s) confirmed. ${failures.length} pending/failed.`},failures.length?207:200);
 }
 return reply({error:'Invalid campaign operation'},400);
}
