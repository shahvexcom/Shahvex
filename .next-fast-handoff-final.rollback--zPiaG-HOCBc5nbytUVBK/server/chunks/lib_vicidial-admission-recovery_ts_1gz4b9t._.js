module.exports=[2248,e=>e.a(async(a,t)=>{try{var i=e.i(58574),d=e.i(49348),n=e.i(7984),_=e.i(92645),s=e.i(17637),r=a([i]);[i]=r.then?(await r)():r;let N=`WITH candidate AS MATERIALIZED (
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
 WHERE r.agent_id=$2 AND r.call_id IN(SELECT id FROM closed) RETURNING r.agent_id`;async function c(e,a,t){let r=await (0,i.db)(),c=(await r.query(`SELECT c.id,c.vicidial_call_id,v.campaign_id FROM ai_agent_runtime_states r JOIN agent_calls c ON c.id=r.call_id
 JOIN campaign_agent_assignments x ON x.agent_id=r.agent_id AND x.enabled
 JOIN campaign_definitions d ON d.id=x.campaign_id AND d.enabled AND d.intake_state='RUNNING' AND d.deleted_at IS NULL
 JOIN voip_agent_assignments v ON v.agent_id=r.agent_id AND v.connection_id=$2 AND v.owner_id=$3 AND v.campaign_id=d.external_campaign_id
 JOIN vicidial_pool_agents q ON q.agent_id=r.agent_id AND q.remote_user=$4 AND q.ready
 WHERE r.agent_id=$1 AND c.voip_connection_id=$2 AND c.status='ANSWERED' AND c.vicidial_call_id IS NOT NULL
 AND d.connection_id=$2 AND d.owner_id=$3 AND COALESCE(c.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')`,[a.agentId,e.id,e.owner_id,a.remoteUser])).rows[0];if(!c)return!1;try{let i=(0,d.decryptCredential)(e.bridge_secret_ciphertext),l=async()=>{let e=await (0,n.requestBridge)(t,i,"/health");return Array.isArray(e.streams)&&e.activeCalls===e.streams.length&&e.streams.every(e=>"string"==typeof e?.callId&&e.callId!==c.id)};if(!await l())return!1;let E=(0,d.decryptCredential)(e.secret_ciphertext),A=async()=>{let t=await (0,_.vicidialRequest)(e.server_url,e.username,E,{function:"agent_status",agent_user:a.remoteUser,stage:"pipe",header:"YES"},!1,2e3);if(/^\s*ERROR:/.test(t))return null;let i=(0,s.parseVicidialTable)(t)[0],d=i?.call_id||i?.callerid||"";return i?.campaign_id===c.campaign_id&&["READY","INCALL"].includes(i.status)&&/^[-\w]{16,40}$/.test(d)?{id:d,status:i.status}:null},g=await A();if(!g||"INCALL"===g.status&&g.id===c.vicidial_call_id)return!1;let o=await A();if(!o||o.id!==g.id||o.status!==g.status||!await l())return!1;let D=await r.query(N,[c.id,a.agentId,e.id,c.vicidial_call_id]);return 1===D.rowCount}catch{return!1}}e.s(["recoverPreviousCallForAdmission",0,c]),t()}catch(e){t(e)}},!1)];

//# sourceMappingURL=lib_vicidial-admission-recovery_ts_1gz4b9t._.js.map