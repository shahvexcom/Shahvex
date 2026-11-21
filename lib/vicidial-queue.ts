import { decryptCredential } from "./credential-crypto";
import { vicidialRequest,requireVicidialSuccess } from "./vicidial";
import type { PoolClient } from "pg";
import { db } from "./database";
import { bpoEntitlements, bpoLeadUsage } from "./bpo-entitlements";

function insideWindow(start:string,end:string) {
  const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const from=start.slice(0,5),to=end.slice(0,5);
  return from===to||(from<to?now>=from&&now<to:now>=from||now<to);
}
export async function queueAgentAllowed(agentId:string,client?:Pick<PoolClient,"query">) {
  const pool=client||await db();
  const a=(await pool.query(`SELECT a.status,a.daily_call_limit,b.bpo_id,b.is_active,b.dialing_mode,q.dialing_source,
    s.is_enabled schedule_enabled,s.start_time::text,s.end_time::text,auto.is_enabled auto_enabled,auto.start_time::text auto_start,auto.end_time::text auto_end,
    (SELECT COUNT(*) FROM agent_calls x WHERE x.agent_id=a.id AND x.created_at>=date_trunc('day',NOW())) today
    FROM agents a JOIN vicidial_pool_agents q ON q.agent_id=a.id
    LEFT JOIN bpo_created_agents b ON b.agent_id=a.id LEFT JOIN agent_call_schedules s ON s.agent_id=a.id
    LEFT JOIN bpo_auto_dialer_settings auto ON auto.bpo_id=b.bpo_id WHERE a.id=$1`,[agentId])).rows[0];
  if(!a||a.status!=='APPROVED'||Number(a.today)>=a.daily_call_limit)return false;
  // Controller scheduling is paused; BPO automation retains its own time window.
  if(!a.bpo_id)return true;
  if(!a.is_active||![a.dialing_source,'BOTH'].includes(a.dialing_mode))return false;
  if(a.dialing_source==='AUTO'&&(!a.auto_enabled||!insideWindow(a.auto_start,a.auto_end)))return false;
  const [limits,usage]=await Promise.all([bpoEntitlements(pool,a.bpo_id),bpoLeadUsage(pool,a.bpo_id)]);
  return usage.calls<limits.calls&&usage.minutes<limits.minutes&&usage.recordings<limits.recordings;
}
export async function reconcileVicidialQueues(connectionId:string) {
  const pool=await db();
  await pool.query("DELETE FROM vicidial_pool_agents q USING vicidial_pools p WHERE p.id=q.pool_id AND p.connection_id=$1 AND q.ready=FALSE AND q.line_state='INACTIVE' AND NOT EXISTS(SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=q.agent_id AND r.call_id IS NOT NULL)",[connectionId]);
  // Resume saved desired intake after process restarts; no call originates here.
  const pending=await pool.query(`SELECT x.agent_id,b.bpo_id FROM campaign_agent_assignments x JOIN agents a ON a.id=x.agent_id AND a.deleted_at IS NULL AND a.status='APPROVED'
    JOIN campaign_definitions d ON d.id=x.campaign_id JOIN voip_connections c ON c.id=d.connection_id
    LEFT JOIN bpo_created_agents b ON b.agent_id=x.agent_id LEFT JOIN ai_agent_runtime_states r ON r.agent_id=x.agent_id
    WHERE d.connection_id=$1 AND x.enabled AND d.enabled AND d.deleted_at IS NULL AND d.intake_state='RUNNING' AND d.validated_at IS NOT NULL
    AND c.enabled AND c.status='CONNECTED' AND c.last_heartbeat_at>NOW()-INTERVAL '90 seconds'
    AND r.call_id IS NULL AND NOT EXISTS(SELECT 1 FROM vicidial_pool_agents q WHERE q.agent_id=x.agent_id AND q.ready)
    LIMIT 50`,[connectionId]);
  for(const a of pending.rows)try{await (await import('./vicidial-live')).startVicidialAgent(a.agent_id,a.bpo_id?{bpoId:a.bpo_id,dialingSource:'MANUAL'}:{});}catch{await pool.query("UPDATE campaign_definitions SET last_error='Agent intake could not resume; verify voice, limits, Native permissions and bridge capacity' WHERE id=(SELECT campaign_id FROM campaign_agent_assignments WHERE agent_id=$1)",[a.agent_id]);}
  const rows=(await pool.query(`SELECT q.*,r.state runtime_state,r.call_id,c.server_url,c.username,c.secret_ciphertext,c.enabled connection_enabled,c.last_heartbeat_at,c.manage_remote_agents,
    d.intake_state,d.enabled campaign_enabled,x.enabled assignment_enabled
    FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id JOIN voip_connections c ON c.id=p.connection_id
    LEFT JOIN ai_agent_runtime_states r ON r.agent_id=q.agent_id LEFT JOIN campaign_agent_assignments x ON x.agent_id=q.agent_id
    LEFT JOIN campaign_definitions d ON d.id=x.campaign_id WHERE p.connection_id=$1`,[connectionId])).rows;
  let confirmed=0,failed=0;
  for(const q of rows){
    // An occupied native line stays attached to its current customer until cleanup.
    if(q.call_id)continue;
    const desired=q.ready&&['READY','OFFLINE'].includes(q.runtime_state)&&q.connection_enabled&&new Date(q.last_heartbeat_at).getTime()>Date.now()-90000
      &&(!q.intake_state||(q.intake_state==='RUNNING'&&q.campaign_enabled&&q.assignment_enabled))&&await queueAgentAllowed(q.agent_id);
    const state=desired?'ACTIVE':'INACTIVE';
    if(['READY','OFFLINE'].includes(q.runtime_state))await pool.query("UPDATE ai_agent_runtime_states SET state=$1 WHERE agent_id=$2 AND call_id IS NULL AND state IN ('READY','OFFLINE')",[desired?'READY':'OFFLINE',q.agent_id]);
    if(q.manage_remote_agents===false)continue;
    if(q.line_state===state)continue;
    try{
      const response=await vicidialRequest(q.server_url,q.username,decryptCredential(q.secret_ciphertext),{function:'update_remote_agent',agent_user:q.remote_user,status:state});
      if(!response.includes(`NOTICE: update_remote_agent REMOTE AGENT IS ALREADY ${state}`))requireVicidialSuccess(response,'update_remote_agent');
      await pool.query("UPDATE vicidial_pool_agents SET line_state=$1,line_error='' WHERE agent_id=$2",[state,q.agent_id]);confirmed++;
    }catch{await pool.query("UPDATE vicidial_pool_agents SET line_state='UNKNOWN',line_error='Native intake operation not confirmed' WHERE agent_id=$1",[q.agent_id]);failed++;}
  }
  // Expiry marks uncertainty; it never frees an unverified customer channel.
  await pool.query(`UPDATE ai_agent_runtime_states r SET state='ERROR',last_error='Bridge heartbeat expired; reconcile AI and customer channel before release',updated_at=NOW()
   FROM agent_calls a WHERE r.call_id=a.id AND a.voip_connection_id=$1 AND r.lease_expires_at<NOW() AND r.state IN ('RESERVED','BUSY')`,[connectionId]);
  return {checked:rows.length,confirmed,failed};
}
