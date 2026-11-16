import { db } from "./database";
import { vicidialRequest } from "./vicidial";
import { decryptCredential } from "./credential-crypto";
import { vicidialLiveConfig } from "./vicidial-config";

/** Called only after the signed bridge reports a real customer/human bridge event. */
export async function confirmHumanHandoff(call: {id:string;vicidial_lead_id:string;transfer_status:string}, connection: {live_config:unknown;server_url:string;username:string;secret_ciphertext:string}, humanUser:string) {
  const live=vicidialLiveConfig.parse(connection.live_config);
  if(!['SUBMITTED','UNCERTAIN','ANSWERED'].includes(call.transfer_status)||live.remoteUsers.includes(humanUser))throw Error('Human handoff is not pending or the destination is an AI line');
  const status=await vicidialRequest(connection.server_url,connection.username,decryptCredential(connection.secret_ciphertext),{function:'agent_status',agent_user:humanUser,stage:'pipe',header:'YES'});
  const rows=status.trim().split(/\r?\n/),headers=rows[0].split('|'),values=rows[1]?.split('|')||[];
  if(values[headers.indexOf('status')]!=='INCALL'||values[headers.indexOf('lead_id')]!==call.vicidial_lead_id)throw Error('VICIdial has not confirmed that this human is connected to the customer');
  await (await db()).query(`UPDATE agent_calls SET transfer_status='ANSWERED',conversation_state='HUMAN_CONNECTED',recording_active=FALSE,updated_at=NOW()
    WHERE id=$1 AND transfer_status IN ('SUBMITTED','UNCERTAIN','ANSWERED')`,[call.id]);
}
