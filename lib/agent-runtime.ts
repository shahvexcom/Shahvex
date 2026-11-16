import type { PoolClient } from "pg";
import { db } from "./database";
type Client=Pick<PoolClient,'query'>;
export const agentRuntimeStates=['OFFLINE','READY','RESERVED','BUSY','TRANSFERRING','ERROR'] as const;
export async function markAgentReady(agentId:string,campaignId:string|null,client?:Client){
 await (client||await db()).query(`INSERT INTO ai_agent_runtime_states(agent_id,campaign_id,state,last_seen_at) VALUES($1,$2,'READY',NOW())
 ON CONFLICT(agent_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id,state='READY',last_error='',last_seen_at=NOW(),updated_at=NOW()
 WHERE ai_agent_runtime_states.call_id IS NULL`,[agentId,campaignId]);
}
export async function reserveAgent(client:Client,agentId:string,callId:string,campaignId:string|null){
 const result=await client.query(`UPDATE ai_agent_runtime_states SET state='RESERVED',call_id=$2,campaign_id=$3,last_assigned_at=NOW(),last_seen_at=NOW(),lease_expires_at=NOW()+INTERVAL '60 seconds',updated_at=NOW()
 WHERE agent_id=$1 AND state='READY' AND call_id IS NULL RETURNING agent_id`,[agentId,callId,campaignId]);
 return result.rowCount===1;
}
export async function mediaReady(callId:string){
 const pool=await db(),tx=await pool.connect();try{await tx.query('BEGIN');
 const r=await tx.query("UPDATE ai_agent_runtime_states SET state='BUSY',last_seen_at=NOW(),updated_at=NOW() WHERE call_id=$1 AND state='RESERVED' RETURNING agent_id",[callId]);
 if(r.rowCount)await tx.query("UPDATE agent_calls SET status='ANSWERED',conversation_state='LISTENING',answered_at=COALESCE(answered_at,NOW()),last_heartbeat_at=NOW() WHERE id=$1 AND status='INITIATED'",[callId]);
 await tx.query('COMMIT');return Boolean(r.rowCount);
 }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
export async function setRuntimeState(callId:string,state:'ERROR'|'TRANSFERRING'|'BUSY',error=''){
 await (await db()).query('UPDATE ai_agent_runtime_states SET state=$1,last_error=$2,updated_at=NOW() WHERE call_id=$3',[state,error,callId]);
}
/** A timestamp expiry is never sufficient evidence to release a customer call. */
export async function releaseConfirmedAgent(callId:string){
 const pool=await db(),tx=await pool.connect();try{await tx.query('BEGIN');
 const call=(await tx.query('SELECT * FROM agent_calls WHERE id=$1 FOR UPDATE',[callId])).rows[0];
 if(!call||!call.ai_leg_released||(!call.customer_ended&&!['SUBMITTED','ANSWERED'].includes(call.transfer_status))){await tx.query('COMMIT');return false;}
 await tx.query(`UPDATE agent_calls SET status=CASE WHEN status='FAILED' THEN status ELSE 'COMPLETED' END,
 conversation_state=CASE WHEN transfer_status IN ('SUBMITTED','ANSWERED') THEN 'HANDED_OFF' ELSE 'COMPLETED' END,
 ended_at=COALESCE(ended_at,ai_media_ended_at,NOW()),recording_active=FALSE,conversation_busy=FALSE,updated_at=NOW() WHERE id=$1`,[callId]);
 await tx.query(`UPDATE ai_agent_runtime_states r SET call_id=NULL,state=CASE WHEN EXISTS(SELECT 1 FROM vicidial_pool_agents q WHERE q.agent_id=r.agent_id AND q.ready=TRUE) THEN 'READY' ELSE 'OFFLINE' END,
 campaign_id=COALESCE((SELECT x.campaign_id FROM campaign_agent_assignments x WHERE x.agent_id=r.agent_id),campaign_id),lease_expires_at=NULL,last_seen_at=NOW(),last_error='',updated_at=NOW() WHERE call_id=$1`,[callId]);
 await tx.query('COMMIT');return true;
 }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
