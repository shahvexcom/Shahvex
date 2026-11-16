import { db } from './database';
import { vicidialRequest } from './vicidial';
import { decryptCredential } from './credential-crypto';
import { vicidialLiveConfig } from './vicidial-config';
import { parseVicidialTable } from './campaign-config';

// A remote-agent audio leg can arrive while READY, before the customer joins it.
// Link only the fixed, exclusive line mapped to this profile, with stable native readback.
export async function linkDirectNativeCall(call:any,connection:any) {
 if(call.vicidial_call_id||call.status!=='ANSWERED')return call;
 const live=vicidialLiveConfig.parse(connection.live_config);
 const line=live.directAudioLines.find(x=>x.prefix===call.direct_audio_line&&x.agentId===call.agent_id);
 if(!line||!live.remoteUsers.includes(line.remoteUser))return call;
 const pool=await db();
 const assigned=await pool.query(`SELECT q.remote_user FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id
 WHERE q.agent_id=$1 AND q.remote_user=$2 AND p.connection_id=$3 AND p.campaign_id=$4 AND q.ready=TRUE`,[call.agent_id,line.remoteUser,connection.id,call.external_campaign_id]);
 if(assigned.rows.length!==1)return call;
 const key=decryptCredential(connection.secret_ciphertext);
 const read=async()=>{
  const raw=await vicidialRequest(connection.server_url,connection.username,key,{function:'agent_status',agent_user:line.remoteUser,stage:'pipe',header:'YES'});
  if(raw.trim().startsWith('ERROR:'))return null;
  const row=parseVicidialTable(raw)[0];
  const id=row?.call_id||row?.callerid||'';
  return row?.status==='INCALL'&&row.campaign_id===call.external_campaign_id&&/^\d+$/.test(row.lead_id)&&/^[-\w]{16,40}$/.test(id)&&!id.startsWith('manual-')?{id,lead:row.lead_id}:null;
 };
 const first=await read();if(!first)return call;
 let lead:Record<string,string>|undefined;
 try{lead=parseVicidialTable(await vicidialRequest(connection.server_url,connection.username,key,{function:'lead_all_info',lead_id:first.lead,stage:'pipe',header:'YES'})).find(x=>x.lead_id===first.lead);}
 catch{lead=await (await import('./vicidial-admin-lead')).readAdminLead(connection.server_url,connection.username,key,first.lead);}
 if(!lead)return call;
 const second=await read();if(!second||second.id!==first.id||second.lead!==first.lead)return call;
 const result=await pool.query(`UPDATE agent_calls a SET vicidial_call_id=$2,vicidial_lead_id=$3,vicidial_agent_user=$4,
 lead_number=$5,vicidial_sync_status='PENDING',updated_at=NOW()
 WHERE a.id=$1 AND a.telephony_provider='AUDIOSOCKET' AND a.status='ANSWERED' AND a.vicidial_call_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM agent_calls other WHERE other.voip_connection_id=a.voip_connection_id AND other.vicidial_call_id=$2 AND other.id<>a.id)
 RETURNING a.*`,[call.id,first.id,first.lead,line.remoteUser,lead.phone_number||'']);
 return result.rows[0]||call;
}
