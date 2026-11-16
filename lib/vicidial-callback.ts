import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { verifyBridgeSignature } from "./vicidial-bridge";
import { vicidialRequest } from "./vicidial";
import { vicidialLiveConfig } from "./vicidial-config";
import { newTest, sessions, testConfig, type TestConfig } from "./agent-test";
import { handleTestSession } from "./agent-test-speculative";
import { pcAiRequest } from "./pc-ai-engine";
import { collectVicidialResult, syncVicidialComments, transferVicidialCall, retryVicidialSyncJobs, hasTransferConsent, hasRequestedHumanHandoff, prepareRequestedHumanHandoff, conversationHash, qualificationHash } from "./vicidial-results";
import { queueAgentAllowed, reconcileVicidialQueues } from "./vicidial-queue";
import { syncVicidialRecording } from "./vicidial-recording";
import { reserveAgent,mediaReady,setRuntimeState,releaseConfirmedAgent } from "./agent-runtime";
import { confirmHumanHandoff } from "./vicidial-handoff";
import { bpoEntitlements, bpoLeadUsage } from "./bpo-entitlements";

const message=z.object({action:z.enum(["connected","listen","turn","interrupt","ended","recording","retry-sync","maintenance","hangup","recover","human-answered","customer-ended","media-ready","resolve-prefix","call-state"]),eventId:z.string().uuid(),externalCallId:z.string().regex(/^[\w-]{16,40}$/),audioUuid:z.string().uuid().optional(),agentUser:z.string().regex(/^[\w-]{2,20}$/).optional(),asteriskUniqueid:z.string().max(100).optional(),asteriskLinkedid:z.string().max(100).optional(),activeCallIds:z.array(z.string().uuid()).max(10000).optional(),humanUser:z.string().regex(/^[\w-]{2,20}$/).optional(),callId:z.string().uuid().optional(),text:z.string().max(4000).optional(),audio:z.string().max(2800000).optional(),opening:z.boolean().optional(),silenceStep:z.number().int().min(1).max(4).optional(),recordingUrl:z.string().url().max(2000).optional(),recordingId:z.string().max(100).optional(),aiRecordingId:z.string().uuid().optional(),recordingSize:z.number().int().min(44).max(1000000044).optional(),durationSeconds:z.number().int().min(0).max(86400).optional()}).strict();
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
type ConversationTurn={role:"user"|"assistant";content:string};
// Installed VICIdial builds use either callerid or call_id for the same native call code.
const statusHeaders=(line:string)=>line.split("|").map(field=>field.trim()==="callerid"?"call_id":field.trim());

async function startVoice(callId:string,agentId:string,config:TestConfig) {
  const owner=`vici-${callId}`,voiceConfig=testConfig.parse(config);
  if(process.env.SHAHVEX_PC_AI_URL) {
    const response=await pcAiRequest("/tester/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId,config:voiceConfig})},owner);
    if(!response.ok)throw Error("Shared voice engine could not start");
    return String((await response.json()).id);
  }
  return newTest(owner,agentId,voiceConfig);
}

export async function vicidialCallback(request:Request) {
  const connectionId=request.headers.get("x-shahvex-connection")||"";
  if(!z.string().uuid().safeParse(connectionId).success)return json({error:"Unauthorized"},401);
  const pool=await db(), c=(await pool.query("SELECT * FROM voip_connections WHERE id=$1",[connectionId])).rows[0];
  if(!c?.bridge_secret_ciphertext)return json({error:"Unauthorized"},401);
  const parts:Uint8Array[]=[];let size=0;
  if(request.body)for await(const chunk of request.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>3000000)return json({error:"Payload too large"},413);parts.push(chunk);}
  const bytes=Buffer.concat(parts),path=new URL(request.url).pathname;
  if(!verifyBridgeSignature(decryptCredential(c.bridge_secret_ciphertext),request.headers.get("x-shahvex-timestamp")||"",request.headers.get("x-shahvex-signature")||"",request.method,path,bytes))return json({error:"Unauthorized"},401);
  const parsed=message.safeParse(JSON.parse(bytes.toString()));if(!parsed.success)return json({error:"Invalid event"},400);
  const v=parsed.data,live=vicidialLiveConfig.parse(c.live_config);
  if((!live.enabled||!c.enabled)&&v.action==='connected')return json({error:'Live calling disabled'},409);
  const key=decryptCredential(c.secret_ciphertext);
  // Speech probes are authenticated reads: do not serialize them through the
  // durable mutation ledger or transcript writes while the caller is speaking.
  if(v.action==='listen'){
    if(!v.callId)return json({error:'Call ID required'},400);
    const call=(await pool.query('SELECT id,status,transfer_status,voice_session_id,vicidial_call_id,direct_audio_uuid FROM agent_calls WHERE id=$1 AND voip_connection_id=$2',[v.callId,c.id])).rows[0];
    const direct=call?.direct_audio_uuid?'direct-'+String(call.direct_audio_uuid).replaceAll('-',''):'';
    if(!call||v.externalCallId!==call.vicidial_call_id&&v.externalCallId!==direct)return json({error:'Call identity mismatch'},409);
    if(call.status!=='ANSWERED'||['PREPARING','UNCERTAIN','SUBMITTED','ANSWERED'].includes(call.transfer_status))return json({error:'Call is no longer handled by AI'},409);
    if(!call.voice_session_id)return json({error:'Voice session is not ready'},409);
    const body=Buffer.from(v.audio||'','base64'),owner=`vici-${call.id}`,init={method:'POST',signal:request.signal,headers:{'content-type':'audio/wav','x-shahvex-session':call.voice_session_id},body};
    if(process.env.SHAHVEX_PC_AI_URL)return pcAiRequest('/tester/listen',init,owner);
    if(!sessions.has(call.voice_session_id))return json({error:'Voice worker is unavailable'},409);
    return handleTestSession(new Request(`${new URL(request.url).origin}/internal?action=listen&id=${call.voice_session_id}`,init),owner);
  }
  if(v.action==='call-state'){
    if(!v.callId)return json({error:'Call ID required'},400);
    const call=(await pool.query("SELECT * FROM agent_calls WHERE id=$1 AND voip_connection_id=$2 AND telephony_provider IN ('VICIDIAL','AUDIOSOCKET')",[v.callId,c.id])).rows[0];
    if(!call)return json({error:'Call not found'},404);
    const direct=call.direct_audio_uuid?'direct-'+String(call.direct_audio_uuid).replaceAll('-',''):'';
    if(v.externalCallId!==call.vicidial_call_id&&v.externalCallId!==direct)return json({error:'Call identity mismatch'},409);
    return json(await (await import('./vicidial-call-state')).observeNativeCustomer(call,c,key));
  }
  if(v.action==='resolve-prefix') {
    if(!c.enabled||!live.enabled||!c.media_verified_at||!v.audioUuid)return json({error:'Direct campaign audio is not enabled'},409);
    const line=live.directAudioLines.find(line=>line.prefix===v.audioUuid!.slice(0,4).toLowerCase());
    if(!line||!live.remoteUsers.includes(line.remoteUser))return json({error:'Unknown audio line'},409);
    const assigned=(await pool.query(`SELECT d.external_campaign_id FROM campaign_agent_assignments x
      JOIN campaign_definitions d ON d.id=x.campaign_id
      JOIN voip_agent_assignments va ON va.agent_id=x.agent_id AND va.connection_id=d.connection_id AND va.owner_id=d.owner_id AND va.campaign_id=d.external_campaign_id
      JOIN vicidial_pool_agents q ON q.agent_id=x.agent_id AND q.remote_user=$3 AND q.ready=TRUE
      JOIN ai_agent_runtime_states rs ON rs.agent_id=x.agent_id AND rs.state='READY' AND rs.call_id IS NULL
      WHERE x.agent_id=$1 AND d.connection_id=$2 AND d.owner_id=$4 AND x.enabled AND d.enabled AND d.deleted_at IS NULL AND d.intake_state='RUNNING'`,[line.agentId,c.id,line.remoteUser,c.owner_id])).rows[0];
    if(!assigned)return json({error:'The assigned audio-line agent is not ready'},409);
    // Start the existing direct-audio route promptly; native identity is verified before transfer.
    if(live.directAudioMode)return json({uuid:v.audioUuid,audioUuid:v.audioUuid,agentUser:line.remoteUser,externalCallId:'direct-'+v.audioUuid.replaceAll('-','')});
    // Prefer a verified native customer call, retaining audio-only fallback for direct extension tests.
    try {
      const status=await vicidialRequest(c.server_url,c.username,key,{function:'agent_status',agent_user:line.remoteUser,stage:'pipe',header:'YES'});
      const [head,row]=status.trim().split(/\r?\n/),keys=statusHeaders(head),values=row?.split('|')||[],get=(name:string)=>String(values[keys.indexOf(name)]||'').trim();
      if(get('status')==='INCALL'&&get('campaign_id')===assigned.external_campaign_id&&/^\d+$/.test(get('lead_id'))&&/^[-\w]{16,40}$/.test(get('call_id'))&&!get('call_id').startsWith('manual-'))
        return json({uuid:v.audioUuid,audioUuid:v.audioUuid,agentUser:line.remoteUser,externalCallId:get('call_id')});
    } catch(error) { if(!live.directAudioMode)throw error; }
    if(live.directAudioMode)return json({uuid:v.audioUuid,audioUuid:v.audioUuid,agentUser:line.remoteUser,externalCallId:'direct-'+v.audioUuid.replaceAll('-','')});
    return json({error:'VICIdial has not confirmed an active call on this line'},409);
  }

  if(v.action==='maintenance'){
    await pool.query('UPDATE voip_connections SET last_heartbeat_at=NOW() WHERE id=$1',[c.id]);
    if(v.activeCallIds?.length){await pool.query('UPDATE agent_calls SET last_heartbeat_at=NOW() WHERE voip_connection_id=$1 AND id=ANY($2::text[])',[c.id,v.activeCallIds]);await pool.query("UPDATE ai_agent_runtime_states r SET last_seen_at=NOW(),lease_expires_at=NOW()+INTERVAL '60 seconds' FROM agent_calls a WHERE r.call_id=a.id AND a.voip_connection_id=$2 AND r.call_id=ANY($1::text[])",[v.activeCallIds,c.id]);}
    await retryVicidialSyncJobs(c.id);
    return json(await reconcileVicidialQueues(c.id));
  }
  const eventHash=createHash('sha256').update(bytes).digest('hex');
  const accepted=await pool.query("INSERT INTO vicidial_events(connection_id,event_id,call_id,kind,payload_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id",[c.id,v.eventId,v.callId||null,v.action,eventHash]);
  if(!accepted.rowCount){
    const prior=(await pool.query('SELECT payload_hash,processing_state,lease_expires_at,response_payload,response_status FROM vicidial_events WHERE connection_id=$1 AND event_id=$2',[c.id,v.eventId])).rows[0];
    if(!prior||prior.payload_hash!==eventHash)return json({error:'Event ID reused with a different payload'},409);
    if(prior.processing_state==='COMPLETED')return json(prior.response_payload||{duplicate:true},prior.response_status||200);
    if(prior.processing_state==='RUNNING'&&new Date(prior.lease_expires_at).getTime()>Date.now())return json({error:'Event still processing'},409);
  }
  const claimed=await pool.query("UPDATE vicidial_events SET processing_state='RUNNING',lease_expires_at=NOW()+INTERVAL '180 seconds' WHERE connection_id=$1 AND event_id=$2 AND (processing_state<>'RUNNING' OR lease_expires_at<NOW()) RETURNING event_id",[c.id,v.eventId]);
  if(!claimed.rowCount)return json({error:'Event is processing'},409);
  try{
    const result=await processEvent();
    if(v.action!=='turn'||!result.ok){
      const payload=await result.clone().json().catch(()=>null);
      await pool.query("UPDATE vicidial_events SET processing_state=$1,processed_at=NOW(),lease_expires_at=NULL,response_payload=$4::jsonb,response_status=$5 WHERE connection_id=$2 AND event_id=$3",[result.ok&&!payload?.syncPending?'COMPLETED':'FAILED',c.id,v.eventId,JSON.stringify(payload),result.status]);
    }
    return result;
  }catch(error){await pool.query("UPDATE vicidial_events SET processing_state='FAILED',lease_expires_at=NULL,last_error='Operation failed; reconciliation required' WHERE connection_id=$1 AND event_id=$2",[c.id,v.eventId]);throw error;}
  async function processEvent(){
  const directHex=/^direct-([a-f0-9]{32})$/.exec(v.externalCallId)?.[1];
  const directUuid=directHex?`${directHex.slice(0,8)}-${directHex.slice(8,12)}-${directHex.slice(12,16)}-${directHex.slice(16,20)}-${directHex.slice(20)}`:null;
  if(v.externalCallId.startsWith('direct-')&&!directUuid)return json({error:'Invalid direct audio identifier'},400);
  let call=directUuid?(await pool.query("SELECT * FROM agent_calls WHERE voip_connection_id=$1 AND direct_audio_uuid=$2 AND telephony_provider='AUDIOSOCKET'",[c.id,directUuid])).rows[0]:(await pool.query("SELECT * FROM agent_calls WHERE voip_connection_id=$1 AND vicidial_call_id=$2",[c.id,v.externalCallId])).rows[0];
  if(v.action==='connected'&&directUuid){
    if(call)return call.voice_session_id?json({callId:call.id,first:call.script_snapshot.first,status:call.status}):json({error:'Direct voice session unavailable; cleanup required',callId:call.id,recover:true},503);
    const line=live.directAudioLines.find(line=>line.prefix===directUuid.slice(0,4)&&line.remoteUser===v.agentUser);
    if(!live.directAudioMode||!c.media_verified_at||!line||v.audioUuid!==directUuid)return json({error:'Direct AudioSocket mode or line is not enabled'},409);
    const tx=await pool.connect();let released=false;
    try{
      await tx.query('BEGIN');
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`direct-audio:${c.id}:${directUuid}`]);
      const prior=(await tx.query("SELECT * FROM agent_calls WHERE voip_connection_id=$1 AND direct_audio_uuid=$2",[c.id,directUuid])).rows[0];
      if(prior){await tx.query('COMMIT');return json({callId:prior.id,first:prior.script_snapshot.first,status:prior.status});}
      const a=(await tx.query(`SELECT a.id,a.name,a.local_voice_id,q.config,q.max_call_duration_seconds,d.id campaign_id,d.external_campaign_id,d.script,b.bpo_id
        FROM agents a JOIN campaign_agent_assignments x ON x.agent_id=a.id AND x.enabled
        JOIN campaign_definitions d ON d.id=x.campaign_id AND d.connection_id=$2 AND d.owner_id=$3
        JOIN voip_agent_assignments va ON va.agent_id=a.id AND va.connection_id=d.connection_id AND va.owner_id=d.owner_id AND va.campaign_id=d.external_campaign_id
        JOIN vicidial_pool_agents q ON q.agent_id=a.id AND q.ready AND q.remote_user=$4
        JOIN ai_agent_runtime_states rs ON rs.agent_id=a.id AND rs.state='READY' AND rs.call_id IS NULL
        LEFT JOIN bpo_created_agents b ON b.agent_id=a.id
        WHERE a.id=$1 AND a.status='APPROVED' AND d.enabled AND d.deleted_at IS NULL AND d.intake_state='RUNNING' AND BTRIM(d.script)<>''
        AND NOT EXISTS(SELECT 1 FROM agent_calls ac WHERE ac.agent_id=a.id AND ac.status IN ('INITIATED','RINGING','ANSWERED'))
        FOR UPDATE OF a SKIP LOCKED`,[line.agentId,c.id,c.owner_id,line.remoteUser])).rows[0];
      if(!a||!await queueAgentAllowed(a.id,tx)){await tx.query('ROLLBACK');return json({error:'Assigned direct audio agent is busy or unavailable'},409);}
      if(a.bpo_id){await tx.query('SELECT id FROM agents WHERE id=$1 FOR UPDATE',[a.bpo_id]);const [limits,usage]=await Promise.all([bpoEntitlements(tx,a.bpo_id),bpoLeadUsage(tx,a.bpo_id)]);if(usage.calls>=limits.calls||usage.minutes>=limits.minutes||usage.recordings>=limits.recordings)throw Error('Workspace calling allowance exhausted');}
      const config=testConfig.parse({...a.config,name:a.name,voice:a.local_voice_id,script:a.script});
      const id=randomUUID();
      await tx.query(`INSERT INTO agent_calls(id,agent_id,status,telephony_provider,voip_connection_id,direct_audio_uuid,direct_audio_line,campaign_definition_id,external_campaign_id,script_snapshot,conversation_state,dialing_source,max_call_duration_seconds,vicidial_sync_status)
        VALUES($1,$2,'INITIATED','AUDIOSOCKET',$3,$4,$5,$6,$7,$8::jsonb,'LISTENING','DIRECT',$9,'NOT_APPLICABLE')`,[id,a.id,c.id,directUuid,line.prefix,a.campaign_id,a.external_campaign_id,JSON.stringify(config),a.max_call_duration_seconds||0]);
      if(!await reserveAgent(tx,a.id,id,a.campaign_id))throw Error('Direct audio agent reservation changed');
      await tx.query('COMMIT');tx.release();released=true;
      try{const session=await startVoice(id,a.id,config);await pool.query('UPDATE agent_calls SET voice_session_id=$1 WHERE id=$2',[session,id]);}
      catch{await setRuntimeState(id,'ERROR','Direct voice startup failed; audio cleanup required');return json({error:'Direct voice startup failed',callId:id,recover:true},503);}
      return json({callId:id,first:config.first,maxCallDurationSeconds:a.max_call_duration_seconds||0});
    }catch(error){if(!released)await tx.query('ROLLBACK');throw error;}finally{if(!released)tx.release();}
  }
  if(v.action==='connected') {
    if(call)return call.voice_session_id?json({callId:call.id,first:call.script_snapshot.first,status:call.status}):json({callId:call.id,error:'Voice session unavailable; cleanup required',recover:true},503);
    if(!v.agentUser||!live.remoteUsers.includes(v.agentUser))return json({error:"Unknown remote agent"},409);
    // Never trust a lead ID or campaign supplied by the audio transport.
    const status=await vicidialRequest(c.server_url,c.username,key,{function:"agent_status",agent_user:v.agentUser,stage:"pipe",header:"YES"});
    const lines=status.trim().split(/\r?\n/),headers=statusHeaders(lines[0]),values=lines[1]?.split('|')||[],get=(name:string)=>values[headers.indexOf(name)];
    if(get('call_id')!==v.externalCallId||get('status')!=='INCALL'||!/^\d+$/.test(get('lead_id')||''))return json({error:"VICIdial has not confirmed this answered call"},409);
    const directLine=v.audioUuid?live.directAudioLines.find(line=>line.prefix===v.audioUuid!.slice(0,4).toLowerCase()&&line.remoteUser===v.agentUser):undefined;
    if(v.audioUuid&&!directLine)return json({error:'Unknown direct audio mapping'},409);
    const route=(await pool.query(`SELECT p.id pool_id,p.campaign_id,cd.id campaign_definition_id FROM vicidial_pools p JOIN vicidial_pool_agents q ON q.pool_id=p.id
      LEFT JOIN campaign_agent_assignments ca ON ca.agent_id=q.agent_id
      LEFT JOIN campaign_definitions cd ON cd.id=ca.campaign_id
      JOIN voip_agent_assignments v ON v.agent_id=q.agent_id AND v.connection_id=p.connection_id AND v.owner_id=p.owner_id
      WHERE p.connection_id=$1 AND p.campaign_id=$2 AND q.remote_user=$3 AND ($4::text IS NULL OR q.agent_id=$4) AND q.ready=TRUE AND v.campaign_id=p.campaign_id AND (ca.agent_id IS NULL OR (ca.enabled=TRUE AND cd.enabled=TRUE AND cd.deleted_at IS NULL AND cd.intake_state='RUNNING' AND cd.external_campaign_id=p.campaign_id AND cd.connection_id=p.connection_id))`,[c.id,get('campaign_id'),v.agentUser,directLine?.agentId||null])).rows[0];
    if(!route||route.campaign_id!==get('campaign_id'))return json({error:"Call is outside the assigned campaign"},409);
    let metadata:string;
    try{metadata=await vicidialRequest(c.server_url,c.username,key,{function:'lead_all_info',lead_id:get('lead_id'),stage:'pipe',header:'YES'});}catch{
      const lead=await (await import('./vicidial-admin-lead')).readAdminLead(c.server_url,c.username,key,get('lead_id')||'');
      const fields=['lead_id','phone_number','phone_code'];metadata=fields.join('|')+'\n'+fields.map(k=>lead[k]||'').join('|');
    }
    const detailLines=metadata.trim().split(/\r?\n/),detailHeaders=detailLines[0].split('|'),detailValues=detailLines[1]?.split('|')||[];
    const detail=(name:string)=>String(detailValues[detailHeaders.indexOf(name)]||'').trim();
    if(detail('lead_id')!==get('lead_id'))return json({error:'VICIdial lead details could not be verified'},409);
    const rawNumber=detail('phone_number'),code=detail('phone_code');
    const number=rawNumber.startsWith('+')?rawNumber:/^[1-9]\d{0,3}$/.test(code)&&/^\d{6,14}$/.test(rawNumber)?`+${code}${rawNumber}`:rawNumber;
    const tx=await pool.connect();
    let released=false;
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`dispatch:${c.id}:${v.externalCallId}`]);
      const duplicate=(await tx.query("SELECT id,script_snapshot FROM agent_calls WHERE voip_connection_id=$1 AND vicidial_call_id=$2",[c.id,v.externalCallId])).rows[0];
      if(duplicate){await tx.query("COMMIT");return json({callId:duplicate.id,first:duplicate.script_snapshot.first});}
      let a;
      const excluded:string[]=[];
      while(excluded.length<=1000){
      const available=await tx.query(`SELECT q.*,a.daily_call_limit,b.bpo_id,rs.last_assigned_at FROM vicidial_pool_agents q JOIN agents a ON a.id=q.agent_id
        LEFT JOIN bpo_created_agents b ON b.agent_id=a.id
        JOIN ai_agent_runtime_states rs ON rs.agent_id=a.id AND rs.state='READY' AND rs.call_id IS NULL
        JOIN vicidial_pools p ON p.id=q.pool_id
        JOIN voip_agent_assignments va ON va.agent_id=a.id AND va.connection_id=p.connection_id AND va.owner_id=p.owner_id AND va.campaign_id=p.campaign_id
        WHERE q.pool_id=$1 AND ($2::text IS NULL OR q.agent_id=$2) AND NOT (q.agent_id=ANY($4::text[])) AND q.ready=TRUE AND a.status='APPROVED'
        AND (rs.campaign_id IS NOT DISTINCT FROM $5::text)
        AND NOT EXISTS(SELECT 1 FROM agent_calls x WHERE x.agent_id=a.id AND x.status IN ('INITIATED','RINGING','ANSWERED'))
        AND NOT EXISTS(SELECT 1 FROM do_not_call d WHERE d.phone_number=$3)
        AND (SELECT COUNT(*) FROM agent_calls x WHERE x.agent_id=a.id AND x.created_at>=date_trunc('day',NOW()))<a.daily_call_limit
        ORDER BY rs.last_assigned_at NULLS FIRST,q.updated_at,a.id
        FOR UPDATE OF a SKIP LOCKED LIMIT 1`,[route.pool_id,directLine?.agentId||null,number,excluded,route.campaign_definition_id||null]);
        a=available.rows[0];
        if(!a){await tx.query("ROLLBACK");return json({error:"No matching available AI agent"},409);}
        // Recheck after acquiring the agent lock using a fresh DB statement.
        const occupied=await tx.query("SELECT id FROM agent_calls WHERE agent_id=$1 AND status IN ('INITIATED','RINGING','ANSWERED') LIMIT 1",[a.agent_id]);
        if(!occupied.rows.length&&await queueAgentAllowed(a.agent_id,tx))break;
        excluded.push(a.agent_id);a=undefined;
      }
      if(!a){await tx.query("ROLLBACK");return json({error:"No eligible campaign agent"},409);}
      if(a.bpo_id){await tx.query("SELECT id FROM agents WHERE id=$1 FOR UPDATE",[a.bpo_id]);const [limits,usage]=await Promise.all([bpoEntitlements(tx,a.bpo_id),bpoLeadUsage(tx,a.bpo_id)]);if(usage.calls>=limits.calls||usage.minutes>=limits.minutes||usage.recordings>=limits.recordings)throw Error("Workspace calling allowance exhausted");}
      const id=randomUUID();
      await tx.query(`INSERT INTO agent_calls(id,agent_id,status,telephony_provider,voip_connection_id,vicidial_call_id,vicidial_lead_id,vicidial_agent_user,lead_number,script_snapshot,answered_at,conversation_state,dialing_source,max_call_duration_seconds)
        VALUES($1,$2,'INITIATED','VICIDIAL',$3,$4,$5,$6,$7,$8::jsonb,NOW(),'LISTENING',$9,$10)`,[id,a.agent_id,c.id,v.externalCallId,get('lead_id'),v.agentUser,number,JSON.stringify(a.config),a.dialing_source,a.max_call_duration_seconds]);
      if(!await reserveAgent(tx,a.agent_id,id,route.campaign_definition_id||null))throw Error('Agent reservation changed; retry routing');
      await tx.query('UPDATE agent_calls SET campaign_definition_id=$1,external_campaign_id=$2,asterisk_uniqueid=$3,asterisk_linkedid=$4 WHERE id=$5',[route.campaign_definition_id||null,get('campaign_id'),v.asteriskUniqueid||null,v.asteriskLinkedid||null,id]);
      await tx.query("COMMIT");
      tx.release();released=true;
      try {const sessionId=await startVoice(id,a.agent_id,a.config);await pool.query("UPDATE agent_calls SET voice_session_id=$1 WHERE id=$2",[sessionId,id]);}
      catch {await setRuntimeState(id,'ERROR','Shared voice engine unavailable; telephony cleanup required');return json({error:'Shared voice engine unavailable; reconciling telephony cleanup',callId:id,recover:true},503);}
      return json({callId:id,first:a.config.first,maxCallDurationSeconds:a.max_call_duration_seconds});
    } catch(error){if(!released)await tx.query("ROLLBACK");throw error;}finally{if(!released)tx.release();}
  }
  if(!call||v.callId!==call.id)return json({error:"Call not found"},404);
  const owner=`vici-${call.id}`,sessionId=call.voice_session_id;
  if(directUuid){
    if(!call.vicidial_call_id&&(v.action==='human-answered'||v.action==='customer-ended'&&v.humanUser))return json({error:'Native handoff is unavailable for an unlinked direct audio call'},409);
    if(v.action==='retry-sync'&&!call.vicidial_call_id){
      try{call=await (await import('./vicidial-direct-link')).linkDirectNativeCall(call,c);}catch{return json({saved:true,syncPending:true,nativeLinkPending:true});}
      if(!call.vicidial_call_id)return json({saved:true,nativeSync:'NOT_APPLICABLE',nativeLinkPending:true});
    }
    if(v.action==='hangup')return json({ended:true}); // Bridge closes the actual audio leg, then emits ended.
    if(!call.vicidial_call_id&&['ended','recover','customer-ended'].includes(v.action)){
      await pool.query("UPDATE agent_calls SET ai_leg_released=TRUE,customer_ended=TRUE,ai_media_ended_at=COALESCE(ai_media_ended_at,NOW()),recording_active=FALSE,conversation_busy=FALSE,duration_seconds=COALESCE($2,duration_seconds),updated_at=NOW() WHERE id=$1",[call.id,v.durationSeconds??null]);
      await releaseConfirmedAgent(call.id);
      if(sessionId){try{if(process.env.SHAHVEX_PC_AI_URL)await pcAiRequest('/tester/stop',{method:'POST',headers:{'x-shahvex-session':sessionId},body:'{}'},owner);else{sessions.get(sessionId)?.abort?.abort();sessions.delete(sessionId);}}catch{/* Call ended independently of voice worker cleanup. */}}
      return json({saved:true,nativeSync:'NOT_APPLICABLE'});
    }
    if(v.action==='recording'&&!v.aiRecordingId)return json({error:'Only bridge AI recordings are supported for direct calls'},409);
  }

  if(v.action==='media-ready'){return await mediaReady(call.id)?json({saved:true}):json({error:'Media reservation is no longer available; reconcile the call'},409);}
  if(v.action==='human-answered'){
    if(!v.humanUser)return json({error:'Human agent user is required'},400);
    await confirmHumanHandoff(call,c,v.humanUser);
    await pool.query('UPDATE voip_connections SET last_human_event_at=NOW() WHERE id=$1',[c.id]);
    await pool.query("UPDATE ai_transfer_attempts SET state='ANSWERED',updated_at=NOW() WHERE call_id=$1 AND state IN ('SUBMITTED','UNCERTAIN')",[call.id]);
    await releaseConfirmedAgent(call.id);
    if(sessionId){try{if(process.env.SHAHVEX_PC_AI_URL)await pcAiRequest('/tester/stop',{method:'POST',headers:{'x-shahvex-session':sessionId},body:'{}'},owner);else{sessions.get(sessionId)?.abort?.abort();sessions.delete(sessionId);}}catch{/* Handoff is confirmed independently of AI cleanup. */}}
    return json({saved:true,humanConnected:true});
  }
  if(v.action==='recover'&&['INITIATED','RINGING','ANSWERED'].includes(call.status)){
    if(['SUBMITTED','UNCERTAIN'].includes(call.transfer_status))return json({saved:true,syncPending:true,awaitingHuman:true});
    const status=await vicidialRequest(c.server_url,c.username,key,{function:'agent_status',agent_user:call.vicidial_agent_user,stage:'pipe',header:'YES'});
    const rows=status.trim().split(/\r?\n/),heads=statusHeaders(rows[0]),values=rows[1]?.split('|')||[];
    if(values[heads.indexOf('call_id')]===call.vicidial_call_id&&values[heads.indexOf('status')]==='INCALL'){
      await (await import('./vicidial-controls')).vicidialCallCommand(call.id,'hangup',call.agent_id);
      return json({saved:true,syncPending:true});
    }
    if(!heads.includes('call_id')&&!/ERROR: agent_status AGENT NOT (?:LOGGED IN|FOUND)/.test(status))return json({saved:true,syncPending:true});
  }
  if(v.action==='hangup'){
    if(['COMPLETED','FAILED'].includes(call.status))return json({ended:true});
    const response=await (await import('./vicidial-controls')).vicidialCallCommand(call.id,'hangup',call.agent_id);
    return response||json({error:'Call not found'},404);
  }
  if(v.action==='listen'||v.action==='turn'||v.action==='interrupt') {
    if(call.status!=='ANSWERED'||['PREPARING','UNCERTAIN','SUBMITTED','ANSWERED'].includes(call.transfer_status))return json({error:"Call is no longer handled by AI",handoffPending:['PREPARING','UNCERTAIN','SUBMITTED','ANSWERED'].includes(call.transfer_status)},409);
    if(!sessionId)return json({error:"Voice session is not ready"},409);
    const body=v.audio?Buffer.from(v.audio,'base64'):Buffer.from(JSON.stringify({text:v.text||"",opening:v.opening===true,...(v.silenceStep?{silenceStep:v.silenceStep}:{})}));
    const action=v.action==='interrupt'?'interrupt':v.action==='listen'?'listen':'turn';
    const init={method:"POST",signal:request.signal,headers:{"content-type":v.audio?'audio/wav':'application/json',"x-shahvex-session":sessionId,"x-shahvex-turn":v.eventId},body};
    let response:Response;
    if(action==='turn'){
      const lease=await pool.query("UPDATE agent_calls SET conversation_busy=TRUE,transfer_consent=FALSE,handoff_ready=FALSE,qualification='{}'::jsonb,updated_at=NOW() WHERE id=$1 AND conversation_busy=FALSE RETURNING id",[call.id]);
      if(!lease.rowCount)return json({error:"Another voice turn is still finishing",retryable:true},409);
    }
    try {
    if(process.env.SHAHVEX_PC_AI_URL)response=await pcAiRequest(`/tester/${action}`,init,owner);
    else {
      if(!sessions.has(sessionId)){await pool.query("UPDATE agent_calls SET conversation_busy=FALSE WHERE id=$1",[call.id]);return json({error:"Voice worker restarted; end this call rather than replaying its introduction"},409);}
      response=await handleTestSession(new Request(`${new URL(request.url).origin}/internal?action=${action}&id=${sessionId}&turnId=${v.eventId}`,init),owner);
    }
    }catch(error){if(action==='turn')await pool.query("UPDATE agent_calls SET conversation_busy=FALSE WHERE id=$1",[call.id]);throw error;}
    if(action==='listen'||action==='interrupt'||!response.ok||!response.body){if(action==='turn')await pool.query("UPDATE agent_calls SET conversation_busy=FALSE WHERE id=$1",[call.id]);return response;}
    let pending="",answer="",user="",done=false;const decoder=new TextDecoder();
    const history:ConversationTurn[]=Array.isArray(call.conversation_history)?call.conversation_history:[];
    const consume=(line:string)=>{if(!line.trim())return;const e=JSON.parse(line);if(e.type==='user')user=e.text;if(e.type==='delta')answer+=e.text;if(e.type==='done')done=true;};
    // Publish the current turn while audio is streaming, without releasing its lease.
    let lastPublished=0,progressWrite:Promise<void>|undefined;
    const publishProgress=async()=>{
      if((!user&&!answer)||Date.now()-lastPublished<750)return;
      lastPublished=Date.now();
      const progress=[...history,...(user?[{role:'user',content:user}]:[]),...(answer?[{role:'assistant',content:answer}]:[])];
      try {await pool.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,conversation_state=CASE WHEN status IN ('COMPLETED','FAILED') THEN 'COMPLETED' ELSE $3 END,updated_at=NOW() WHERE id=$4 AND conversation_busy=TRUE",[JSON.stringify(progress),progress.map(t=>`${t.role==='user'?'CLIENT':'AGENT'}: ${t.content}`).join('\n'),answer?'SPEAKING':'THINKING',call.id]);}
      catch {/* Monitoring must not interrupt customer audio; final persistence retries. */}
    };
    const stream=new ReadableStream({async start(controller){try{
      for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){pending+=decoder.decode(chunk,{stream:true});let at;while((at=pending.indexOf('\n'))>=0){consume(pending.slice(0,at));pending=pending.slice(at+1);}controller.enqueue(chunk);
        if(!progressWrite&&Date.now()-lastPublished>=750)progressWrite=publishProgress().finally(()=>{progressWrite=undefined;});}
      pending+=decoder.decode();if(pending.trim())consume(pending);
    }catch{ /* Disconnects preserve only the received transcript; no restart. */ }finally{
      await progressWrite;
      if(user)history.push({role:'user',content:user});if(answer)history.push({role:'assistant',content:answer});
      await pool.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,conversation_busy=FALSE,conversation_state=CASE WHEN status IN ('COMPLETED','FAILED') THEN 'COMPLETED' ELSE $3 END,updated_at=NOW() WHERE id=$4",[JSON.stringify(history),history.map(t=>`${t.role==='user'?'CLIENT':'AGENT'}: ${t.content}`).join('\n'),done?'LISTENING':'INTERRUPTED',call.id]);
      await pool.query("UPDATE vicidial_events SET processing_state='COMPLETED',processed_at=NOW(),lease_expires_at=NULL,last_error=$1 WHERE connection_id=$2 AND event_id=$3",[done?'':'Turn interrupted; do not replay spoken audio',c.id,v.eventId]);
      try{controller.close();}catch{/* Consumer disconnected. */}
    }}});
    return new Response(stream,{headers:{'content-type':'application/x-ndjson','cache-control':'no-store','x-accel-buffering':'no'}});
  }
  if(v.action==='recording') {
    if(v.aiRecordingId){
      const url=new URL(`/recordings/${v.aiRecordingId}.wav`,live.bridgeUrl).href;
      await pool.query("UPDATE agent_calls SET ai_recording_id=$1,recording_id=$1,recording_url=$2,recording_size_bytes=$3,recording_active=FALSE,updated_at=NOW() WHERE id=$4",[v.aiRecordingId,url,v.recordingSize||0,call.id]);
      return json({saved:true});
    }

    if(!v.recordingUrl)return json({error:"Recording URL required"},400);
    const url=new URL(v.recordingUrl),base=new URL(live.recordingBaseUrl||c.server_url);
    if(url.origin!==base.origin||url.username||url.password||!url.pathname.startsWith(base.pathname==='/'?'/':base.pathname.replace(/\/vicidial\/non_agent_api.php$/,'')))return json({error:"Recording host is not configured"},400);
    await pool.query("UPDATE agent_calls SET vicidial_recording_url=$1,updated_at=NOW() WHERE id=$2",[url.href,call.id]);
  }
  let cleanupPending=false;
  if(v.action==='ended'||v.action==='recover'||v.action==='customer-ended') {
    if(v.action==='ended'||v.action==='recover')await pool.query('UPDATE agent_calls SET ai_leg_released=TRUE,ai_media_ended_at=COALESCE(ai_media_ended_at,NOW()) WHERE id=$1',[call.id]);
    if(v.action==='customer-ended')await pool.query('UPDATE agent_calls SET customer_ended=TRUE WHERE id=$1',[call.id]);
    if((v.action==='ended'||v.action==='recover')&&!call.customer_ended&&!['SUBMITTED','UNCERTAIN','ANSWERED'].includes(call.transfer_status)){
      const native=await vicidialRequest(c.server_url,c.username,key,{function:'agent_status',agent_user:call.vicidial_agent_user,stage:'pipe',header:'YES'});
      const rows=native.trim().split(/\r?\n/),heads=statusHeaders(rows[0]),values=rows[1]?.split('|')||[];
      const ended=/ERROR: agent_status AGENT NOT (?:LOGGED IN|FOUND)/.test(native)||(heads.includes('call_id')&&values[heads.indexOf('call_id')]!==call.vicidial_call_id);
      if(ended)await pool.query('UPDATE agent_calls SET customer_ended=TRUE WHERE id=$1',[call.id]);
      else {cleanupPending=true;await setRuntimeState(call.id,'ERROR','AI media ended; native customer state must be reconciled');}
    }

    await releaseConfirmedAgent(call.id);
    if(sessionId){try {if(process.env.SHAHVEX_PC_AI_URL)await pcAiRequest('/tester/stop',{method:'POST',headers:{'x-shahvex-session':sessionId},body:'{}'},owner);else{sessions.get(sessionId)?.abort?.abort();sessions.delete(sessionId);}}catch{/* Durable call result remains available for retry. */}}
  }
  if(cleanupPending)return json({saved:true,syncPending:true,cleanupPending:true});
  if(v.action==='ended'||v.action==='recover'||v.action==='customer-ended'||v.action==='retry-sync') {
    try {
      call=(await pool.query("SELECT * FROM agent_calls WHERE id=$1",[call.id])).rows[0];
      if(call.conversation_busy)return json({saved:true,syncPending:true});
      if(v.action==='retry-sync'&&['COMPLETED','FAILED'].includes(call.status)){
        if(!['SYNCED','NOT_APPLICABLE'].includes(call.vicidial_sync_status))await syncVicidialComments(call.id);
        return json({saved:true});
      }
      if(v.action==='retry-sync'&&call.status==='ANSWERED'&&!hasTransferConsent(call.conversation_history||[]))return json({saved:true,verificationPending:true,transferConsent:false});
      const history=call.conversation_history||[],audit=call.qualification;
      const currentAudit=Boolean(audit?.historyHash&&audit?.scriptHash)&&audit.historyHash===conversationHash(history)&&audit.scriptHash===qualificationHash(call.script_snapshot);
      const requested=hasRequestedHumanHandoff(history);
      const result=requested&&call.status==='ANSWERED'?await prepareRequestedHumanHandoff(call.id,history,call.script_snapshot,audit):currentAudit?{consent:call.transfer_consent,handoffReady:call.handoff_ready}:await collectVicidialResult(call.id,history,JSON.stringify(call.script_snapshot));
      // Requested human access must not wait for slow lead synchronization. The
      // durable sync job and saved partial answers remain independent of handoff.
      let syncPending=true;
      const sync=syncVicidialComments(call.id).then(()=>{syncPending=false;}).catch(()=>{syncPending=true;});
      if(!requested) {await sync;if(syncPending)throw Error('Lead synchronization pending');}
      if(requested&&v.action==='retry-sync'&&call.status==='ANSWERED'){
        let submitted=false,transferReason='';
        try{await transferVicidialCall(call.id);submitted=true;}catch(error){transferReason=error instanceof Error?error.message:'Transfer preparation failed';}
        // Sync continues with durable retries; its network latency must not delay
        // transfer acknowledgment or AI detach when native submission succeeds.
        const status=(await pool.query('SELECT transfer_status FROM agent_calls WHERE id=$1',[call.id])).rows[0]?.transfer_status;
        return json({saved:true,syncPending,...(submitted||status==='SUBMITTED'||status==='ANSWERED'?{transferSubmitted:true}:status==='UNCERTAIN'?{transferUncertain:true}:{transferPending:true,transferReason,syncPending:true})});
      }
      await sync;
      if(syncPending)return json({saved:true,syncPending:true});
      if((call.status!=='ANSWERED'||v.action==='ended')&&!await syncVicidialRecording(call.id))return json({saved:true,syncPending:true});
      if(v.action==='retry-sync'&&result.consent&&result.handoffReady&&call.status==='ANSWERED'){
        try {await transferVicidialCall(call.id);return json({saved:true,transferSubmitted:true});}
        catch(error) {
          const transferReason=error instanceof Error?error.message:'Transfer preparation failed';
          const status=(await pool.query("SELECT transfer_status FROM agent_calls WHERE id=$1",[call.id])).rows[0]?.transfer_status;
          if(status==='UNCERTAIN'||status==='SUBMITTED')return json({saved:true,transferUncertain:status==='UNCERTAIN'});
          return json({saved:true,syncPending:true,transferPending:true,transferReason});
        }
      }
    }
    catch {await pool.query("UPDATE agent_calls SET vicidial_sync_status='RETRY' WHERE id=$1",[call.id]);return json({saved:true,syncPending:true});}
  }
  return json({saved:true});
  }
}
