import { recordingReference } from "./recording-reference";
import { db } from "./database";
import { vicidialRequest } from "./vicidial";
import { decryptCredential } from "./credential-crypto";
import { vicidialLiveConfig } from "./vicidial-config";
import { bridgeRecordingResponse } from "./vicidial-bridge";

/** Resolve VICIdial's actual recording, never manufacture a recording URL. */
export async function syncVicidialRecording(callId:string) {
  const pool=await db();
  const a=(await pool.query(`SELECT a.*,c.live_config,c.server_url,c.username,c.secret_ciphertext
    FROM agent_calls a JOIN voip_connections c ON c.id=a.voip_connection_id WHERE a.id=$1 AND a.telephony_provider='VICIDIAL'`,[callId])).rows[0];
  if(!a||a.ai_recording_id)return true;
  if(a.vicidial_recording_url)return false;
  const live=vicidialLiveConfig.parse(a.live_config);
  const response=await vicidialRequest(a.server_url,a.username,decryptCredential(a.secret_ciphertext),{function:'recording_lookup',lead_id:a.vicidial_lead_id,agent_user:a.vicidial_agent_user,stage:'pipe',header:'YES',duration:'Y'});
  const lines=response.trim().split(/\r?\n/),headers=lines.shift()?.split('|')||[];
  const candidates=lines.map(line=>{const values=line.split('|');return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));}).filter(row=>row.lead_id===a.vicidial_lead_id&&row.user===a.vicidial_agent_user&&row.location);
  // A lead is claimed only once on this website; the dialer recording must also
  // be from this call's remote user. Retain the latest matching native recording.
  const row=candidates.sort((a,b)=>String(b.start_time).localeCompare(String(a.start_time)))[0];
  if(!row)return false;
  const url=new URL(row.location),base=new URL(live.recordingBaseUrl||new URL(a.server_url).origin);
  if(!['https:','http:'].includes(url.protocol)||url.origin!==base.origin||url.username||url.password||!url.pathname.startsWith(base.pathname))throw Error('Recording server does not match the saved VoIP settings');
  await pool.query("UPDATE agent_calls SET vicidial_recording_url=$1,updated_at=NOW() WHERE id=$2",[url.href,callId]);
  return false;
}

/** Caller must enforce portal ownership before invoking this private proxy. */
export async function vicidialRecordingResponse(callId:string,request:Request) {
  const a=(await (await db()).query(`SELECT a.recording_serial,a.ai_recording_id,c.live_config,c.bridge_secret_ciphertext FROM agent_calls a JOIN voip_connections c ON c.id=a.voip_connection_id WHERE a.id=$1 AND a.telephony_provider IN ('VICIDIAL','AUDIOSOCKET')`,[callId])).rows[0];
  if(!a?.ai_recording_id)return Response.json({message:"AI-only recording is not ready yet."},{status:404});
  try {
    const live=vicidialLiveConfig.parse(a.live_config);
    return await bridgeRecordingResponse(live.bridgeUrl,decryptCredential(a.bridge_secret_ciphertext),a.ai_recording_id,request,recordingReference({id:callId,recording_serial:a.recording_serial}));
  }catch{return Response.json({message:"AI recording could not be downloaded. Check the audio bridge connection."},{status:502});}
}
