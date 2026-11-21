import {db} from './database';
import {vicidialRequest} from './vicidial';
import {parseVicidialTable} from './campaign-config';
/** Observe only the already-linked customer. No native hangup or agent-status mutation. */
export async function observeNativeCustomer(call:any,connection:any,key:string){
 if(call.customer_ended||['COMPLETED','FAILED'].includes(call.status))return {customerEnded:true};
 if(call.transfer_status==='SUBMITTED'||call.transfer_status==='ANSWERED')return {transferSubmitted:true};
 if(['PREPARING','UNCERTAIN'].includes(call.transfer_status))return {awaitingTransfer:true};
 if(!call.vicidial_call_id||!call.vicidial_agent_user||!call.vicidial_lead_id)return {linked:false};
 const read=async()=>{
  const raw=await vicidialRequest(connection.server_url,connection.username,key,{function:'agent_status',agent_user:call.vicidial_agent_user,stage:'pipe',header:'YES'},false,2500);
  if(/ERROR: agent_status AGENT NOT (?:LOGGED IN|FOUND)/.test(raw))return {state:'ended',signature:'offline'};
  const rows=parseVicidialTable(raw),row=rows[0];if(rows.length!==1||!row)return {state:'unknown',signature:''};
  const id=row.call_id||row.callerid||'',signature=[row.status,id,row.lead_id].join('|');
  if(row.status==='INCALL'&&id===call.vicidial_call_id&&row.lead_id===String(call.vicidial_lead_id))return {state:'alive',signature};
  if((row.status==='READY'&&!id)||(['READY','PAUSED','DISPO','DEAD'].includes(row.status)&&id===call.vicidial_call_id)||row.status==='INCALL'&&/^[-\w]{16,40}$/.test(id)&&/^\d+$/.test(row.lead_id)&&id!==call.vicidial_call_id)return {state:'ended',signature};
  return {state:'unknown',signature};
 };
 const first=await read();if(first.state!=='ended')return {linked:true,customerEnded:false,customerActive:first.state==='alive'};
 const second=await read();if(second.state!=='ended'||second.signature!==first.signature)return {linked:true,customerEnded:false};
 const result=await(await db()).query(`UPDATE agent_calls SET customer_ended=TRUE,ended_at=COALESCE(ended_at,NOW()),updated_at=NOW() WHERE id=$1 AND voip_connection_id=$2 AND vicidial_call_id=$3 AND status IN ('INITIATED','RINGING','ANSWERED') AND COALESCE(transfer_status,'') NOT IN ('PREPARING','SUBMITTED','UNCERTAIN','ANSWERED') RETURNING id`,[call.id,connection.id,call.vicidial_call_id]);
 return {linked:true,customerEnded:result.rowCount===1};
}
