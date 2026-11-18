import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { requestBridge } from "./vicidial-bridge";
import { vicidialRequest } from "./vicidial";
import { parseVicidialTable } from "./campaign-config";

export const confirmedOldCallReleaseSql=`WITH candidate AS MATERIALIZED (
 SELECT c.id FROM agent_calls c JOIN ai_agent_runtime_states r ON r.call_id=c.id AND r.agent_id=c.agent_id
 WHERE c.id=$1 AND c.agent_id=$2 AND c.voip_connection_id=$3 AND c.vicidial_call_id=$4
 AND EXISTS(SELECT 1 FROM campaign_agent_assignments x JOIN campaign_definitions d ON d.id=x.campaign_id JOIN vicidial_pool_agents q ON q.agent_id=x.agent_id JOIN voip_connections v ON v.id=d.connection_id WHERE x.agent_id=$2 AND x.enabled AND q.ready AND d.connection_id=$3 AND d.enabled AND d.deleted_at IS NULL AND d.intake_state='RUNNING' AND v.enabled AND v.status='CONNECTED')
 AND c.status='ANSWERED' AND COALESCE(c.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')
 FOR UPDATE OF c,r
), closed AS (
 UPDATE agent_calls c SET ai_leg_released=TRUE,customer_ended=TRUE,status='COMPLETED',conversation_state='COMPLETED',
 ai_media_ended_at=COALESCE(ai_media_ended_at,NOW()),ended_at=COALESCE(ended_at,ai_media_ended_at,NOW()),conversation_busy=FALSE,recording_active=FALSE,updated_at=NOW()
 WHERE c.id IN(SELECT id FROM candidate) RETURNING c.id
) UPDATE ai_agent_runtime_states r SET state='READY',call_id=NULL,lease_expires_at=NULL,last_error='',last_seen_at=NOW(),updated_at=NOW()
 WHERE r.agent_id=$2 AND r.call_id IN(SELECT id FROM closed) RETURNING r.agent_id`;
/** Only a verified gone AI leg plus stable native evidence can release a previous call. */
export async function recoverPreviousCallForAdmission(connection:any,line:{agentId:string;remoteUser:string},bridgeUrl:string){
 const pool=await db();const old=(await pool.query(`SELECT c.id,c.vicidial_call_id,v.campaign_id FROM ai_agent_runtime_states r JOIN agent_calls c ON c.id=r.call_id
 JOIN campaign_agent_assignments x ON x.agent_id=r.agent_id AND x.enabled
 JOIN campaign_definitions d ON d.id=x.campaign_id AND d.enabled AND d.intake_state='RUNNING' AND d.deleted_at IS NULL
 JOIN voip_agent_assignments v ON v.agent_id=r.agent_id AND v.connection_id=$2 AND v.owner_id=$3 AND v.campaign_id=d.external_campaign_id
 JOIN vicidial_pool_agents q ON q.agent_id=r.agent_id AND q.remote_user=$4 AND q.ready
 WHERE r.agent_id=$1 AND c.voip_connection_id=$2 AND c.status='ANSWERED' AND c.vicidial_call_id IS NOT NULL
 AND d.connection_id=$2 AND d.owner_id=$3 AND COALESCE(c.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')`,[line.agentId,connection.id,connection.owner_id,line.remoteUser])).rows[0];
 if(!old)return false;
 try{
  const health=await requestBridge(bridgeUrl,decryptCredential(connection.bridge_secret_ciphertext),'/health');
  if(!Array.isArray(health.streams)||health.activeCalls!==health.streams.length||health.streams.some((s:any)=>s.callId===old.id))return false;
  const key=decryptCredential(connection.secret_ciphertext);
  const read=async()=>{const raw=await vicidialRequest(connection.server_url,connection.username,key,{function:'agent_status',agent_user:line.remoteUser,stage:'pipe',header:'YES'},false,2000);if(/^\s*ERROR:/.test(raw))return null;const s=parseVicidialTable(raw)[0],id=s?.call_id||s?.callerid||'';return s?.campaign_id===old.campaign_id&&['READY','INCALL'].includes(s.status)&&/^[-\w]{16,40}$/.test(id)?{id,status:s.status}:null;};
  const first=await read();if(!first||first.status==='INCALL'&&first.id===old.vicidial_call_id)return false;
  const second=await read();if(!second||second.id!==first.id||second.status!==first.status)return false;
  // Recheck desired intake under the SQL lock too; a concurrent Pause must win.
  const result=await pool.query(confirmedOldCallReleaseSql,[old.id,line.agentId,connection.id,old.vicidial_call_id]);return result.rowCount===1;
 }catch{return false;}
}
