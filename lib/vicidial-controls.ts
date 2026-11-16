import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { vicidialRequest, requireVicidialSuccess } from "./vicidial";
import { vicidialLiveConfig } from "./vicidial-config";
import { requestBridge } from "./vicidial-bridge";
import { syncVicidialComments, transferVicidialCall } from "./vicidial-results";

/** Returns null only for a non-VICIdial call; existing provider code is preserved. */
export async function vicidialCallCommand(id:string,action:string,agentId?:string,controllerOnly=false) {
  const pool=await db();
  const a=(await pool.query(`SELECT a.*,c.live_config,c.server_url,c.username,c.secret_ciphertext,c.bridge_secret_ciphertext FROM agent_calls a JOIN voip_connections c ON c.id=a.voip_connection_id
    WHERE a.id=$1 AND a.telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND ($2::text IS NULL OR a.agent_id=$2) AND (NOT $3::boolean OR NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.agent_id))`,[id,agentId||null,controllerOnly])).rows[0];
  if(!a)return null;
  try {
    if(a.telephony_provider==='AUDIOSOCKET'&&!a.vicidial_call_id&&['sync-comments','transfer','record-start','record-stop'].includes(action))throw Error('This direct audio call is not linked to a native VICIdial call; native sync and transfer are unavailable');
    if(action==='sync-comments'){await syncVicidialComments(id);return Response.json({message:"VICIdial comments synchronized."});}
    if(action==='transfer'){await syncVicidialComments(id);await transferVicidialCall(id);return Response.json({message:"Human transfer submitted; waiting for dialer confirmation."});}
    if(!['ANSWERED','RINGING','INITIATED'].includes(a.status))throw Error("This call has ended");
    if(action==='hangup'&&a.telephony_provider==='AUDIOSOCKET'){
      const live=vicidialLiveConfig.parse(a.live_config);
      const result=await requestBridge(live.bridgeUrl,decryptCredential(a.bridge_secret_ciphertext),'/command',{callId:id,action:'close-audio'});
      if(result.accepted!==true)throw Error('Audio bridge did not confirm call closure');
      return Response.json({message:'Closing direct audio call.'});
    }
    if(action==='hangup') {
      requireVicidialSuccess(await vicidialRequest(a.server_url,a.username,decryptCredential(a.secret_ciphertext),{function:'ra_call_control',agent_user:a.vicidial_agent_user,value:a.vicidial_call_id,stage:'HANGUP'},true),'ra_call_control');
      await pool.query("UPDATE agent_calls SET ending_requested=TRUE,conversation_state='ENDING',updated_at=NOW() WHERE id=$1",[id]);
      return Response.json({message:"Ending call; waiting for VICIdial confirmation."});
    }
    if(action==='record-start'||action==='record-stop')throw Error("VICIdial campaign recording is automatic. Manage it on the dialer; this control cannot stop the dialer's recording.");
    if(action==='hold'||action==='resume'){
      const live=vicidialLiveConfig.parse(a.live_config);
      const result=await requestBridge(live.bridgeUrl,decryptCredential(a.bridge_secret_ciphertext),'/command',{callId:id,action});
      if(result.accepted!==true)throw Error("Audio bridge did not accept the hold command");
      await pool.query("UPDATE agent_calls SET on_hold=$1,conversation_state=$2,updated_at=NOW() WHERE id=$3",[action==='hold',action==='hold'?'ON_HOLD':'LISTENING',id]);
      return Response.json({message:action==='hold'?"AI audio paused.":"AI audio resumed."});
    }
    throw Error("Unsupported VICIdial call action");
  }catch(error){return Response.json({message:error instanceof Error?error.message:'VICIdial command failed'},{status:409});}
}
