import "server-only";
import { shahvexApi, shahvexFailure, shahvexHeaders, shahvexJson, ShahvexError, smallJson } from "./shahvex-api";
import { boundedRequest, createShahvexSession, ownedShahvexSession, sameOrigin, shahvexAgent, shahvexDb, shahvexPrincipal, shahvexRate } from "./shahvex-access";
import { inspectSpeechWav } from "./agent-test-audio";

export async function shahvexHealth(request:Request) {
  try {
    const s=await shahvexPrincipal(new URL(request.url).searchParams.get("portal"));await shahvexRate(s.agentId);
    const data=await smallJson(await shahvexApi("/health",{signal:request.signal}));
    return shahvexJson({status:data.status==="ready"?"ready":"unavailable",capabilities:{audioInput:true,textInput:false,streaming:data.streaming===true,memory:data.multi_turn_memory===true,agentConfigurationApi:false,sessionTranscript:false}},data.status==="ready"?200:503);
  } catch(e){return shahvexFailure(e);}
}
export async function shahvexConversation(request:Request,streaming:boolean) {
  let locked="",turnKey="";
  let pendingResponse: Response | undefined;
  try {
    const s=await shahvexPrincipal(new URL(request.url).searchParams.get("portal"));sameOrigin(request);await shahvexRate(s.agentId);
    if(!request.headers.get("content-type")?.startsWith("multipart/form-data"))throw new ShahvexError(415,"This gateway requires a microphone WAV recording; text messages are not supported");
    const bytes=await boundedRequest(request,2_000_000);
    let input:FormData;
    try {input=await new Request(request.url,{method:"POST",headers:{"Content-Type":request.headers.get("content-type")!},body:bytes}).formData();}catch{throw new ShahvexError(400,"Invalid recording upload");}
    if([...input.keys()].some(k=>!["audio","agentId","sessionId","turnId"].includes(k)||input.getAll(k).length!==1))throw new ShahvexError(400,"Unsupported conversation fields");
    const audio=input.get("audio"),agentId=input.get("agentId"),sessionId=input.get("sessionId"),turnId=input.get("turnId");
    if(!(audio instanceof File)||typeof agentId!=="string"||typeof turnId!=="string"||!/^[\w-]{1,80}$/.test(turnId)||(sessionId!==null&&typeof sessionId!=="string"))throw new ShahvexError(400,"Invalid conversation request");
    const wav=new Uint8Array(await audio.arrayBuffer());
    let speech=false;try{speech=inspectSpeechWav(wav).speech;}catch{throw new ShahvexError(400,"Recording must be 16 kHz mono PCM WAV");}
    if(!speech)throw new ShahvexError(422,"No confirmed speech detected");
    await shahvexAgent(s,agentId);
    const id=sessionId||await createShahvexSession(s,agentId),{row,agent}=await ownedShahvexSession(s,id);
    if(row.agent_id!==agentId)throw new ShahvexError(403,"Session belongs to another agent");
    const pool=await shahvexDb(),client=await pool.connect();
    try {
      await client.query("BEGIN");
      const acquired=await client.query("UPDATE shahvex_sessions SET busy_until=NOW()+INTERVAL '250 seconds' WHERE id=$1 AND owner_id=$2 AND closed_at IS NULL AND expires_at>NOW() AND (busy_until IS NULL OR busy_until<NOW()) RETURNING id",[id,s.agentId]);
      if(!acquired.rowCount)throw new ShahvexError(409,"Previous turn is still processing");
      const dedup=await client.query("INSERT INTO shahvex_turns(session_id,turn_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING turn_id",[id,turnId]);
      if(!dedup.rowCount)throw new ShahvexError(409,"This turn was already submitted");
      await client.query("COMMIT");locked=id;turnKey=turnId;
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    const form=new FormData();form.append("audio",new Blob([wav],{type:"audio/wav"}),"speech.wav");
    form.append("agent_id",row.upstream_agent_id);form.append("voice_id",agent.local_voice_id);form.append("agent_name",agent.name);
    if(row.upstream_id)form.append("session_id",row.upstream_id);
    const upstream=await shahvexApi(streaming?"/conversation/stream":"/conversation",{method:"POST",form,signal:request.signal});
    pendingResponse=upstream;
    const sid=upstream.headers.get("x-session-id");
    const invalid=!sid||!/^[a-f0-9]{32}$/.test(sid)||Boolean(row.upstream_id&&row.upstream_id!==sid)||upstream.headers.get("x-agent-id")!==row.upstream_agent_id||upstream.headers.get("x-voice-id")!==agent.local_voice_id||!upstream.body||
      (streaming?(upstream.headers.get("x-audio-format")!=="pcm_s16le"||upstream.headers.get("x-sample-rate")!=="24000"||upstream.headers.get("x-channels")!=="1"):!upstream.headers.get("content-type")?.startsWith("audio/wav"));
    if(invalid){await upstream.body?.cancel();throw new ShahvexError(502,"AI response configuration does not match the assigned agent");}
    await pool.query("UPDATE shahvex_sessions SET upstream_id=$1 WHERE id=$2 AND owner_id=$3",[sid,id,s.agentId]);
    const reader=upstream.body!.getReader();locked="";pendingResponse=undefined;let released=false,outputSize=0;
    const release=async()=>{if(released)return;released=true;await pool.query("UPDATE shahvex_sessions SET busy_until=NULL WHERE id=$1",[id]).catch(()=>{});};
    const body=new ReadableStream<Uint8Array>({
      async pull(controller){try{const part=await reader.read();if(part.done){await release();reader.releaseLock();controller.close();return;}outputSize+=part.value.length;if(outputSize>(streaming?12_000_000:4_000_000)){await reader.cancel();throw Error("Output limit");}controller.enqueue(part.value);}catch{await release();controller.error(new Error("AI audio stream ended unexpectedly"));}},
      async cancel(){try{await reader.cancel();}finally{await release();}},
    });
    return new Response(body,{headers:{...shahvexHeaders,"Content-Type":streaming?"application/octet-stream":"audio/wav","X-Session-ID":id,...(streaming?{"X-Audio-Format":"pcm_s16le","X-Sample-Rate":"24000","X-Channels":"1"}:{}),"X-Accel-Buffering":"no"}});
  }catch(e){await pendingResponse?.body?.cancel().catch(()=>{});if(locked){const p=await shahvexDb();if(e instanceof ShahvexError&&e.status===409)await p.query("DELETE FROM shahvex_turns WHERE session_id=$1 AND turn_id=$2",[locked,turnKey]).catch(()=>{});await p.query("UPDATE shahvex_sessions SET busy_until=NULL WHERE id=$1",[locked]).catch(()=>{});}return shahvexFailure(e);}
}
export async function shahvexSession(request:Request,id:string,close=false) {
  try {
    const s=await shahvexPrincipal(new URL(request.url).searchParams.get("portal"));if(close)sameOrigin(request);await shahvexRate(s.agentId);
    const {row,agent}=await ownedShahvexSession(s,id);
    if(close){
      if(row.upstream_id){const r=await shahvexApi(`/sessions/${row.upstream_id}`,{method:"DELETE",signal:request.signal});await r.body?.cancel();}
      await (await shahvexDb()).query("UPDATE shahvex_sessions SET closed_at=NOW() WHERE id=$1 AND owner_id=$2",[id,s.agentId]);return shahvexJson({closed:true});
    }
    if(!row.upstream_id)return shahvexJson({sessionId:id,agentId:agent.id,busy:false,turnCount:0,historyMessages:0});
    const data=await smallJson(await shahvexApi(`/sessions/${row.upstream_id}`,{signal:request.signal}));
    if(data.session_id!==row.upstream_id||data.agent_id!==row.upstream_agent_id||data.voice_id!==agent.local_voice_id)throw new ShahvexError(502,"AI session configuration mismatch");
    return shahvexJson({sessionId:id,agentId:agent.id,busy:data.busy===true,turnCount:Number.isSafeInteger(data.turn_count)&&data.turn_count>=0?data.turn_count:0,historyMessages:Number.isSafeInteger(data.history_messages)&&data.history_messages>=0?data.history_messages:0});
  }catch(e){return shahvexFailure(e);}
}
