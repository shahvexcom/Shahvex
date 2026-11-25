'use strict';
const {initialAudio,hasSpeech,noCustomerSpeechMs}=require('./initial-audio.cjs');
const {isVoicemailGreeting}=require('../../gateway/voicemail-detection.cjs');
// Install beside Asterisk (or behind a private VPN). AudioSocket stays private.
const {createCallAnswer}=require('./call-answer.cjs');
const {CustomerSilence}=require('../../gateway/conversation-silence.cjs');
const {OpeningResponseTimeout}=require('../../gateway/opening-response-timeout.cjs');

const {asksToWait,interruptionKind,isGreetingOnly}=require('../../gateway/conversation-flow.cjs');
const {FLOW_REVISION,isListeningSignal}=require('../../gateway/conversation-resume.cjs');
const {isDirectedAbuse,explicitlyEndsCall}=require('../../gateway/customer-conduct.cjs');
const {isCustomerQuestion}=require('../../gateway/conversation-recovery.cjs');
const {isTransferOffer,affirmativeTransferConsent,withdrawsHumanRequest,customerRequestsHuman}=require('../../gateway/handoff-intent.cjs');
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {createAiRecording,recoverAiRecording}=require('./ai-recording.cjs');
const {publish:publishListeners,closeListeners}=require('./live-listeners.cjs');
const {createTelephoneDownsampler}=require('./audio-quality.cjs');
const {configureSpeech,suppressNoise,measureSpeech,speechDecision}=require('./input-speech.cjs');
const speechPreRollBytes=300*16;
const bargeInVoicedMs=200;
const speechHangoverMs=200;
const signature=(secret,time,method,url,body)=>crypto.createHmac('sha256',secret).update(`${time}\n${method}\n${url}\n`).update(body).digest('hex');
const signed=(secret,req,body)=>{
  const time=req.headers['x-shahvex-timestamp']||'',sig=req.headers['x-shahvex-signature']||'';
  if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>60000||!/^[a-f0-9]{64}$/.test(sig))return false;
  return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(secret,time,req.method,req.url,body),'hex'));
};
function packet(type,body=Buffer.alloc(0)){const header=Buffer.alloc(3);header[0]=type;header.writeUInt16BE(body.length,1);return Buffer.concat([header,body]);}
function wav(pcm){const out=Buffer.alloc(44+pcm.length);out.write('RIFF');out.writeUInt32LE(36+pcm.length,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);return out;}
function shortAnswerPolarity(text){
  const answer=String(text||'').trim().toLowerCase();
  if(/^(?:yes|yeah|yep|yup)[.!]*$/.test(answer))return 'affirmative';
  if(/^(?:no|nope)[.!]*$/.test(answer))return 'negative';
}
function upsample(pcm){const out=Buffer.alloc(pcm.length*2);for(let i=0;i<pcm.length;i+=2){const a=pcm.readInt16LE(i),b=i+2<pcm.length?pcm.readInt16LE(i+2):a;out.writeInt16LE(a,i*2);out.writeInt16LE(Math.round((a+b)/2),i*2+2);}return out;}
const customerFirstIntroMs = 8000;
const customerFirstDeadlineMs = 10000;
const answerDetection = reason => reason === 'call_answer_detection';
const nativeDeadline = reason => reason === 'script_duration_limit' || reason === 'initial_no_speech_timeout' || reason === 'no_customer_speech_deadline';
const requiresNativeConfirmation = reason => nativeDeadline(reason) || answerDetection(reason) || reason === 'abusive_language';

function createBridge({siteUrl,connectionId,secret,spoolDir,fetchImpl=fetch,logger=console.error,maxCalls=10,testOnly=false,allowUnregisteredManualAudio=false,localMonitor,resolveRegistration,playbackBufferMs=120,speech,onCapacityChange,createSpeechScorer,enforceInitialSilence=false,callAnswerOptions}={}){
  if(enforceInitialSilence&&typeof createSpeechScorer!=='function')throw Error('Initial silence enforcement requires Silero');
  if(!Number.isInteger(playbackBufferMs)||playbackBufferMs<0||playbackBufferMs>500)throw Error('Configure playback buffering between 0 and 500 ms');
  const speechConfig=configureSpeech(speech);
  const {endOfSpeechMs}=speechConfig;
  const listeningSpeechConfig={...speechConfig,gateDbfs:Math.max(-90,speechConfig.gateDbfs-4),
    shortSpeechDbfs:Math.max(-90,speechConfig.shortSpeechDbfs-4)};
  const bufferFrames=Math.ceil(playbackBufferMs/20);
  const playbackHighWaterFrames=250;
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw Error('Configure a valid bridge concurrent-call capacity');
  const site=new URL(siteUrl);if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||!secret||secret.length<32)throw Error('Configure HTTPS site URL, connection UUID and a secret of at least 32 characters');
  fs.mkdirSync(spoolDir,{recursive:true});const prepared=new Map(),registered=new Map(),calls=new Map(),startingCalls=new Set(),recentSpeech=[];
  const callAnswer=callAnswerOptions&&createCallAnswer({spoolDir,...callAnswerOptions});
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[\w-]+\.prepare\.json$/.test(n))){try{const value=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));if(value.connectionId===connectionId)prepared.set(value.remoteUser,value);}catch{/* Invalid saved mapping is not used. */}}
  const recordingDir=path.join(spoolDir,'recordings');
  const audioSockets=new Set(), audioIds=new Map();
  const endpoint=new URL('/api/telephony/vicidial',site);
  async function callback(value,signal){const body=Buffer.from(JSON.stringify(value)),time=String(Date.now());return fetchImpl(endpoint,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(125000)]):AbortSignal.timeout(125000),headers:{'content-type':'application/json','x-shahvex-connection':connectionId,'x-shahvex-timestamp':time,'x-shahvex-signature':signature(secret,time,'POST',endpoint.pathname,body)},body});}
  function persistEvent(value){fs.writeFileSync(path.join(spoolDir,`${value.eventId}.event.json`),JSON.stringify(value),{mode:0o600});}
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.call\.json$/.test(n))){
    try{const previous=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));const recording=recoverAiRecording(recordingDir,name.replace('.call.json',''));if(recording)persistEvent({action:'recording',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId,aiRecordingId:recording.id,recordingSize:recording.bytes});persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId,endInitiation:{reason:'audio_bridge_failure',decidedAt:new Date().toISOString(),evidence:'bridge_session_lost'}});fs.unlinkSync(path.join(spoolDir,name));}catch{logger('Active call recovery metadata could not be read');}
  }
  const retryStates=new Map(),pendingSync=new Map(),confirmationTimers=new Set();let backgroundRetryAt=0,shuttingDown=false;
  const terminal=action=>['ended','recover','customer-ended','human-answered','hangup'].includes(action);
  const timeSensitive=action=>terminal(action)||action==='recording';
  const deferEvent=(value,confirmationFile)=>{const attempts=Math.min(6,(retryStates.get(value.eventId)?.attempts||0)+1);
    if(value.action==='playback-complete'&&attempts>=3&&[...calls.values()].some(call=>call.callId===value.callId&&call.handoffAnnouncement===value.completedTurnId)){
      fs.rmSync(path.join(spoolDir,`${value.eventId}.event.json`),{force:true});retryStates.delete(value.eventId);logger('Handoff playback reconciliation exhausted');return;
    }
    if(attempts>=6&&(nativeDeadline(value.endInitiation?.reason)||answerDetection(value.endInitiation?.reason)||value.endInitiation?.reason==='customer_silence_timeout')){
      persistEvent({...value,bridgeRetryExhausted:true});
      retryStates.delete(value.eventId);
      if(answerDetection(value.endInitiation?.reason))callAnswer?.log(value.callId,'native_result',{result:'retries_exhausted'});
      else logger(`Native confirmation still pending for call ${value.callId}: ${value.endInitiation.reason}`);
      return;
    }
    const fast=confirmationFile&&attempts<=3;
    const delay=fast?250*2**(attempts-1):timeSensitive(value.action)?Math.min(10000,1000*2**(attempts-1)):Math.min(60000,10000*2**(attempts-1));
    retryStates.set(value.eventId,{attempts,next:Date.now()+delay});
    if(fast&&!shuttingDown){
      const timer=setTimeout(()=>{
        confirmationTimers.delete(timer);
        if(fs.existsSync(confirmationFile))void deliverEvent(value,confirmationFile,true);
      },delay);
      confirmationTimers.add(timer);
      timer.unref();
    }
  };
  const delivering=new Set(),deliveringCalls=new Set();const urgent=action=>['ended','recover','customer-ended','human-answered','hangup','playback-complete'].includes(action);
  const independent=action=>urgent(action)||action==='recording';
  async function deliverEvent(value,file,immediate=false){
    // A queued hold interruption only applies to the live playback it stopped.
    if(value.action==='interrupt'&&![...calls.values()].some(call=>
      call.callId===value.callId&&call.externalCallId===value.externalCallId&&!call.closed)){
      fs.rmSync(file,{force:true});
      retryStates.delete(value.eventId);
      return;
    }
    if((retryStates.get(value.eventId)?.next||0)>Date.now()||!immediate&&!timeSensitive(value.action)&&backgroundRetryAt>Date.now())return;
    if(delivering.has(value.eventId)||(!independent(value.action)&&deliveringCalls.has(value.externalCallId)))return;delivering.add(value.eventId);if(!independent(value.action))deliveringCalls.add(value.externalCallId);
    try{const response=await callback(value,timeSensitive(value.action)?AbortSignal.timeout(value.action==='recording'?3000:40000):undefined);if(response.ok){const result=await response.json();if(!result.ended&&!result.watchdogCancelled&&!result.answerDetectionCancelled&&(!testOnly&&value.action==='hangup'||requiresNativeConfirmation(value.endInitiation?.reason)))result.syncPending=true;if(!result.syncPending)retryStates.delete(value.eventId);
      if(answerDetection(value.endInitiation?.reason)){
        callAnswer?.log(value.callId,'native_result',{ended:Boolean(result.ended),submitted:Boolean(result.hangupSubmitted),pending:Boolean(result.syncPending),cancelled:Boolean(result.answerDetectionCancelled)});
      }
      if(requiresNativeConfirmation(value.endInitiation?.reason)&&!answerDetection(value.endInitiation?.reason)){
        if(result.ended&&!result.aiDetached&&!result.cleanupPending)logger(`Customer termination confirmed for call ${value.callId}`);
        else if(result.hangupSubmitted)logger(`Native hangup submitted for call ${value.callId}; confirmation pending`);
        else if(result.nativeHangupPending)logger(`Native call identity pending for call ${value.callId}`);
      }
      const active=[...calls.values()].find(c=>c.callId===value.callId&&c.externalCallId===value.externalCallId);
      if(active&&value.action==='retry-sync'){
        active.syncHandoffPending=Boolean(result.transferPending||result.transferUncertain||result.awaitingHuman);
        active.linkRetryDelay=result.nativeLinkPending?250:1000;
        if(result.nativeLinkPending){clearTimeout(active.syncRetryTimer);active.syncRetryTimer=undefined;}
        active.syncWanted=Boolean(active.syncDirty||result.syncPending||result.nativeLinkPending);
        active.syncDirty=false;
        if(active.syncWanted)scheduleSync(active);
      }
      if(active&&result.answerDetectionCancelled)active.ending=false;
      if(active&&result.watchdogCancelled){active.businessOutcome=true;active.watchdogPending=false;}
      if(active&&value.action==='playback-complete'&&result.resumeVoice&&active.handoffAnnouncement===value.completedTurnId){
        active.handoffAnnouncement=undefined;active.handoffPending=false;active.prepareRequested=false;active.syncHandoffPending=false;
        active.resumeAfterHandoffFailure?.();
      }
      if(active&&(result.humanConnected||value.action==='customer-ended'||result.transferSubmitted||value.action==='hangup'&&(result.ended||testOnly&&!result.syncPending)))releaseAiMedia(active);
      if(result.syncPending&&(urgent(value.action)||value.action==='recording')){
        const confirming=['ended','recover','hangup'].includes(value.action)&&
          !result.ended&&!result.awaitingHuman&&(result.cleanupPending||result.hangupSubmitted)&&!result.nativeHangupPending;
        deferEvent(value,confirming?file:undefined);
      }
      if(!result.syncPending){fs.rmSync(file,{force:true});if(pendingSync.get(value.externalCallId)?.eventId===value.eventId)pendingSync.delete(value.externalCallId);}
    }else{if(answerDetection(value.endInitiation?.reason))callAnswer?.log(value.callId,'native_result',{result:'callback_rejected',status:response.status});if(value.action==='playback-complete'&&[404,409].includes(response.status)){fs.rmSync(file,{force:true});retryStates.delete(value.eventId);}else{if(response.status===429||response.status>=500)backgroundRetryAt=Date.now()+30000;deferEvent(value);}await response.body?.cancel();}}catch(error){backgroundRetryAt=Date.now()+30000;deferEvent(value);if(answerDetection(value.endInitiation?.reason))callAnswer?.log(value.callId,'native_result',{result:error?.name==='TimeoutError'?'callback_timed_out':'callback_failed'});else logger(`VICIdial ${value.action} callback ${error?.name==='TimeoutError'?'timed out':'failed'}; retry saved`);}finally{delivering.delete(value.eventId);if(!independent(value.action))deliveringCalls.delete(value.externalCallId);}
  }
  const flushingLanes=new Set();
  async function flushEvents(){
    const entries=fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.event\.json$/.test(n)).flatMap(name=>{
      try{const file=path.join(spoolDir,name);const value=JSON.parse(fs.readFileSync(file,'utf8'));return value.bridgeRetryExhausted?[]:[{file,value}];}catch{return [];}
    });
    const lane=action=>action==='recording'?'recording':urgent(action)?'lifecycle':'sync';
    await Promise.all(['lifecycle','recording','sync'].map(async name=>{
      if(flushingLanes.has(name))return;
      flushingLanes.add(name);
      try{
        const due=entries.filter(({value})=>lane(value.action)===name&&!delivering.has(value.eventId)&&(retryStates.get(value.eventId)?.next||0)<=Date.now());
        for(let i=0;i<due.length;i+=3)await Promise.all(due.slice(i,i+3).map(({file,value})=>deliverEvent(value,file)));
      }finally{flushingLanes.delete(name);}
    }));
  }
  function scheduleSync(c){
    if(c.closed||c.transferred||c.silenceHangupPending||c.syncRetryTimer)return;
    c.syncRetryTimer=setTimeout(()=>{c.syncRetryTimer=undefined;if(c.syncWanted&&!c.closed&&!c.transferred)event(c,'retry-sync',{},true);},c.linkRetryDelay||1000);c.syncRetryTimer.unref();
  }
  function event(c,action,extra={},scheduled=false){
    if(action==='retry-sync'){c.syncWanted=true;if(deliveringCalls.has(c.externalCallId)){if(!scheduled)c.syncDirty=true;scheduleSync(c);return;}}
    const value=action==='retry-sync'&&pendingSync.get(c.externalCallId)||{action,eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,...extra};if(action==='retry-sync')pendingSync.set(c.externalCallId,value);persistEvent(value);
    if(independent(action)||action==='retry-sync'){void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`),independent(action));if(action==='retry-sync')scheduleSync(c);}else void flushEvents();
  }
  function finishRecording(c,closeMonitor=true){
    if(closeMonitor)closeListeners(c);
    try{
      const recording=c.recorder?.finish();
      if(recording)event(c,'recording',{aiRecordingId:recording.id,recordingSize:recording.bytes});
    }catch{logger(`Recording finalization failed for call ${c.callId}`);}
  }
  function releaseAiMedia(active){
    if(active.closed||active.transferred||calls.get(active.uuid)!==active)return;
    active.answerDetector?.close();
    active.transferred=true;active.epoch++;active.queue.length=0;active.controller?.abort();
    active.socket?.end(packet(0)); // Detach only this AI AudioSocket leg.
    if(active.handoffPending){
      // Flush the end frame and close locally without waiting for the peer to close.
      active.socket?.destroySoon();
    }else{
      active.detachTimer=setTimeout(()=>active.socket?.destroy(),500);active.detachTimer.unref();
      finishRecording(active);
    }
  }
  const control=http.createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32000)return reply(413,{error:'Too large'});chunks.push(chunk);}const raw=Buffer.concat(chunks);
      if(!signed(secret,req,raw))return reply(401,{error:'Unauthorized'});
      if(req.method==='GET'&&req.url==='/health')return reply(200,{protocol:'shahvex-vicidial-v1',callCleanupRevision:1,audioLinkRevision:2,flowRevision:FLOW_REVISION,noCustomerSpeechDeadlineRevision:2,noCustomerSpeechDeadlineMs:noCustomerSpeechMs,scriptDurationDeadlineRevision:1,semanticTurnCompletion:false,candidatePauseMs:endOfSpeechMs,audioSocket:audio.listening,sharedTester:true,aiOnlyRecording:true,humanAnswerEvents:true,maxCalls,activeCalls:calls.size,audioConnections:audioSockets.size,startingCalls:startingCalls.size,testOnly,recentSpeech:recentSpeech.slice(-5),streams:[...calls.values()].map(c=>({callId:c.callId,prefix:c.uuid.slice(0,4),voiceFlowRevision:c.voiceFlowRevision||"missing",speechProbeFailures:c.speechProbeFailures||0,speechFallbacks:0,lastSpeechIssue:c.lastSpeechIssue||null,inputPcmBytes:c.inputPcmBytes||0,outputPcmBytes:c.outputPcmBytes||0,inputVoicedMs:c.inputVoicedMs||0,underruns:c.underruns||0,backpressureTicks:c.backpressureTicks||0,lateTicks:c.lateTicks||0,interruptions:c.interruptions||0,admissionMs:c.admissionMs,firstOutputMs:c.firstOutputMs}))});
      if(req.method==='POST'&&req.url==='/capacity'){
        let limit;try{limit=JSON.parse(raw.toString()).limit;}catch{return reply(400,{error:'Invalid capacity'});}
        if(!Number.isInteger(limit)||limit<1||limit>300)return reply(400,{error:'Choose 1-300 concurrent calls'});
        if(Math.max(audioSockets.size,calls.size+startingCalls.size)>limit)return reply(409,{error:'Active calls exceed the requested limit'});
        if(onCapacityChange)await onCapacityChange(limit);
        maxCalls=limit;return reply(200,{maxCalls,activeCalls:calls.size,startingCalls:startingCalls.size});
      }
      if(testOnly&&localMonitor&&req.url==='/local-monitor'&&['GET','POST'].includes(req.method)){
        try{const data=await localMonitor(req.method==='POST'?JSON.parse(raw.toString()):undefined);data.calls=data.calls.map(item=>{const c=[...calls.values()].find(c=>c.callId===item.id);return c?{...item,recording_active:!!c.recorder?.active,ai_recording_id:c.recorder?.ready?c.uuid:null}:item;});return reply(200,data);} 
        catch(error){return reply(400,{error:error.message});}
      }
      const listenMatch=/^\/listen\/([a-f0-9-]{36})\.pcm$/.exec(req.url||'');
      if(req.method==='GET'&&listenMatch){
        const c=[...calls.values()].find(c=>c.callId===listenMatch[1]);
        if(!c||c.closed||c.transferred||c.handoffPending||c.ending)return reply(409,{error:'This call is not available for live listening'});
        c.listeners ||= new Set();
        if(c.listeners.size>=8||[...calls.values()].reduce((n,c)=>n+(c.listeners?.size||0),0)>=64)return reply(429,{error:'Live listener capacity reached'});
        res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'private, no-store, no-transform','x-accel-buffering':'no','x-audio-sample-rate':'8000','x-audio-channels':'2'});res.flushHeaders();
        c.listeners.add(res);const expiry=setTimeout(()=>res.end(),15*60*1000);expiry.unref();
        const cleanup=()=>{clearTimeout(expiry);c.listeners.delete(res);};res.on('close',cleanup);res.on('error',cleanup);return;
      }
      const recordingMatch=/^\/recordings\/([a-f0-9-]{36})\.wav$/.exec(req.url||'');
      if(req.method==='GET'&&recordingMatch){
        const file=path.join(recordingDir,`${recordingMatch[1]}.wav`);
        if(!fs.existsSync(file))return reply(404,{error:'AI recording not ready'});
        const size=fs.statSync(file).size,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
        const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
        if(start>end||start>=size)return reply(416,{error:'Invalid range'});
        res.writeHead(range?206:200,{'content-type':'audio/wav','content-length':end-start+1,'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${size}`}:{})});
        const source=fs.createReadStream(file,{start,end});source.on('error',()=>res.destroy());res.on('close',()=>source.destroy());source.pipe(res);return;
      }
      const value=JSON.parse(raw.toString());
      if(req.method==='POST'&&req.url==='/prepare'){
        if(value.connectionId!==connectionId||!/^[\w-]{2,20}$/.test(value.remoteUser||''))return reply(400,{error:'Invalid remote user'});
        prepared.set(value.remoteUser,value);fs.writeFileSync(path.join(spoolDir,`${value.remoteUser}.prepare.json`),JSON.stringify(value),{mode:0o600});return reply(200,{accepted:true});
      }
      if(req.method==='POST'&&req.url==='/register'){
        if(testOnly?value.manualTest!==true||value.agentUser!=='manual-test'||!/^manual-[a-f0-9]{32}$/.test(value.externalCallId||''):value.manualTest===true||String(value.externalCallId||'').startsWith('manual-'))return reply(409,{error:'Registration mode mismatch'});
        if(!/^[a-f0-9-]{36}$/.test(value.uuid||'')||!/^[\w-]{16,40}$/.test(value.externalCallId||'')||!prepared.has(value.agentUser))return reply(409,{error:'Line not prepared'});
        const prior=registered.get(value.uuid);
        const current=prior?.expires>Date.now()?prior:audioIds.get(value.uuid);
        if(current){
          const same=['externalCallId','agentUser','asteriskUniqueid','asteriskLinkedid'].every(key=>current[key]===value[key]);
          return same?reply(200,{accepted:true}):reply(409,{error:'Audio UUID already registered to a different call'});
        }
        if(registered.size>=maxCalls*2&&!prior)return reply(429,{error:'Capacity reached'});
        registered.set(value.uuid,{...value,expires:Date.now()+30000});return reply(200,{accepted:true});
      }
      if(req.method==='POST'&&req.url==='/handoff-event'){
        if(!/^[\w-]{16,40}$/.test(value.externalCallId||'')||!['human-answered','customer-ended'].includes(value.action)||value.action==='human-answered'&&!/^[\w-]{2,20}$/.test(value.humanUser||''))return reply(400,{error:'Invalid handoff event'});
        const active=[...calls.values()].find(c=>c.externalCallId===value.externalCallId);
        const savedFile=path.join(spoolDir,`${value.externalCallId}.handoff.json`);
        const mapping=active||(fs.existsSync(savedFile)?JSON.parse(fs.readFileSync(savedFile,'utf8')):null);
        if(!mapping)return reply(409,{error:'No matching handoff'});
        const eventValue={action:value.action,eventId:value.eventId||crypto.randomUUID(),externalCallId:mapping.externalCallId,callId:mapping.callId,...(value.humanUser?{humanUser:value.humanUser}:{})};
        if(!/^[a-f0-9-]{36}$/.test(eventValue.eventId))return reply(400,{error:'Invalid event ID'});
        persistEvent(eventValue);
        const file=path.join(spoolDir,`${eventValue.eventId}.event.json`);
        let result;
        try{
          const response=await callback(eventValue,AbortSignal.timeout(8000));
          result=await response.json();
          if(!response.ok)throw Error('Handoff confirmation pending retry');
        }catch{
          deferEvent(eventValue);
          return reply(503,{error:'Handoff confirmation pending retry'});
        }
        if(!result.syncPending)fs.rmSync(file,{force:true});
        if(active)releaseAiMedia(active);
        return reply(200,{accepted:true,...result});
      }
      if(req.method==='POST'&&req.url==='/command'){
        const c=[...calls.values()].find(c=>c.callId===value.callId);if(!c)return reply(404,{error:'Call not found'});
        if(value.action==='close-audio'&&(c.externalCallId.startsWith('direct-')||testOnly)){releaseAiMedia(c);return reply(200,{accepted:true});}
        if(value.action==='detach-ai'&&c.handoffPending){releaseAiMedia(c);return reply(200,{accepted:true});}
        if(value.action==='record-start'||value.action==='record-stop'){
          if(c.closed||c.transferred||c.handoffPending||c.ending)return reply(409,{error:'AI recording has ended'});
          const recording=value.action==='record-stop'?c.recorder.pause():(c.recorder.resume(),null);
          return reply(200,{accepted:true,recordingActive:c.recorder.active,...(recording?{aiRecordingId:recording.id,recordingSize:recording.bytes}:{})});
        }
        if(value.action!=='hold'&&value.action!=='resume'&&value.action!=='handoff-prepare')return reply(400,{error:'Unsupported command'});
        if(value.action==='handoff-prepare'){
          if(c.ending)return reply(409,{error:'Call termination is pending'});
          c.prepareRequested=true;c.priorityPauseEpoch=undefined;const deadline=Date.now()+9000;
          while((c.queue.length||c.writing)&&!c.closed&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          if(c.closed||c.ending||c.queue.length||c.writing){c.prepareRequested=false;return reply(409,{error:'AI playback is not ready for handoff'});}
          c.handoffPending=true;return reply(200,{accepted:true});
        }
        c.silenceClock.pause(Date.now());
        c.hold=value.action==='hold';if(c.hold){c.playbackReported=true;c.queue.length=0;c.controller?.abort();event(c,'interrupt');}return reply(200,{accepted:true});
      }
      return reply(404,{error:'Unknown operation'});
    }catch{return reply(503,{error:'Bridge operation failed'});}
  });
  const audio=net.createServer(socket=>{
    const acceptedAt=Date.now();
    socket.setNoDelay(true);
    if(audioSockets.size>=maxCalls){socket.end(packet(0));return;}audioSockets.add(socket);
    let pending=Buffer.alloc(0),c,claimedUuid,initializing=false,closing=false,remoteHangup=false,writing=false,lastTick=Date.now();
    const admissionAbort=new AbortController();
    let admissionStage='audio_uuid',writeStartedAt;
    const admissionTimeout=setTimeout(()=>{
      logger(`Audio lifecycle failure: ${admissionStage} deadline`);
      admissionAbort.abort();
      if(c&&!c.mediaReady)void endCustomerCall(true,'audio_link_timeout',admissionStage);
      else socket.destroy();
    },10000);
    admissionTimeout.unref();
    const timer=setInterval(()=>{
      const tick=Date.now(),late=tick-lastTick>35;lastTick=tick;
      if(!c?.mediaReady||socket.destroyed)return;
      if(late)c.lateTicks=(c.lateTicks||0)+1;
      if(writing){
        c.backpressureTicks=(c.backpressureTicks||0)+1;
        if(tick-writeStartedAt>=5000&&!c.ending&&!c.transferred&&!c.handoffPending&&!c.prepareRequested){void endCustomerCall(true,'audio_bridge_failure','socket_write_timeout');return;}
      }
      if(c.lastInputAt!==undefined&&tick-c.lastInputAt>=endOfSpeechMs){
        if(c.frames.length)finishUtterance(true);
        else if(c.voiceFrames)discardSpeechOnset();
        c.preRoll=[];
      }
      const input=c.captureInput.subarray(0,320);c.captureInput=c.captureInput.subarray(Math.min(320,c.captureInput.length));
      if(!c.playbackReady&&c.queue.length&&(c.queue.length>=((c.openingTurn||c.introductionTurn)&&!c.turnWrittenBytes?2:bufferFrames)||c.synthesisDone))c.playbackReady=true;
      if(c.playbackReady&&!c.queue.length&&c.processing&&!c.synthesisDone){c.underruns=(c.underruns||0)+1;c.playbackReady=false;}
      // A provisional pause retains the queue and its read position until final STT.
      const frame=!c.ending&&!c.hold&&!c.handoffPending&&c.priorityPauseEpoch!==c.epoch&&!writing&&c.playbackReady&&c.queue.length?c.queue.shift():Buffer.alloc(0);
      publishListeners(c,input,frame);
      try{if(!c.handoffPending)c.recorder?.frame(input,frame);}catch{
        logger('AI recording failed; customer media remains active');
        finishRecording(c,false);c.recorder=undefined;
      }
      if(!frame.length){
        reportPlayback();
        return;
      }
      if(c.firstOutputMs===undefined){c.firstOutputMs=Date.now()-acceptedAt;logger(`Audio startup prefix ${c.uuid.slice(0,4)}: admission ${c.admissionMs}ms, first PCM ${c.firstOutputMs}ms`);}
      if(c.openingTurn)c.openingResponse.output(Date.now());
      if(c.handoffAnnouncement)c.handoffPlaybackStarted=true;
      const epoch=c.epoch;
      if(c.turnTiming?.epoch===epoch&&!c.turnTiming.firstWriteAt){
        const measurement=c.turnTiming;
        measurement.firstWriteAt=tick;
        logger(`Voice latency call ${c.callId} turn ${measurement.turnId}: ${JSON.stringify({
          ...measurement.stages,
          endpointingMs:measurement.endpointAt-measurement.speechEndAt,
          recognitionQueueMs:measurement.probeAt-measurement.endpointAt,
          recognitionMs:measurement.recognizedAt-measurement.probeAt,
          dispatchMs:measurement.dispatchedAt-measurement.recognizedAt,
          ...(measurement.firstPcmAt!==undefined?{
            dispatchToBridgePcmMs:measurement.firstPcmAt-measurement.dispatchedAt,
            bridgePcmToWriteMs:tick-measurement.firstPcmAt,
          }:{}),
          firstAudioSocketWriteMs:tick-measurement.speechEndAt
        })}`);
      }
      writing=true;c.writing=true;writeStartedAt=tick;
      c.lastOutputAt=tick;c.answerDetector?.playback();
      socket.write(packet(0x10,frame),error=>{
        writing=false;c.writing=false;
        if(error){c.playbackReported=true;socket.destroy();return;}
        c.outputPcmBytes=(c.outputPcmBytes||0)+frame.length;
        if(c.epoch===epoch){c.turnWrittenBytes+=frame.length;c.renderedThisTurn=true;}
        c.lastSpeech=Date.now();
      });
    },20);timer.unref();
    function reportPlayback(){
      if(c.priorityPauseEpoch!==c.epoch&&c.renderedThisTurn&&c.synthesisDone&&!c.processing&&!c.queue.length&&!writing&&!c.playbackReported&&!c.closed&&!c.ending&&!c.transferred&&!c.handoffPending&&c.lastVoiceTurnId){
        if(c.handoffAnnouncement&&(c.frames.length||c.recognizing))return;
        c.playbackReported=true;
        c.completedTurnId=c.lastVoiceTurnId;
        logger(`Playback complete call ${c.callId} turn ${c.lastVoiceTurnId} epoch ${c.epoch}: ${c.turnWrittenBytes} PCM bytes`);
        event(c,'playback-complete',{completedTurnId:c.lastVoiceTurnId});
        c.hasCompletedSpeech=true;
        c.stepInterruptions=0;
        const deferred=c.afterPlaybackReply;
        c.afterPlaybackReply=undefined;
        if(deferred&&!c.handoffAnnouncement&&!c.endAfterPlayback)
          queueMicrotask(()=>{if(c.epoch===deferred.epoch)void turn({text:deferred.text},deferred.recognition);});
        if(c.endOfferTurn===c.lastVoiceTurnId){
          c.endOfferTurn=undefined;
          const reply=c.endOfferReply;c.endOfferReply=undefined;
          if(reply)queueMicrotask(()=>void turn(reply.payload,reply.recognition));
        }
      }
    }
    async function turn(payload,recognition,retryingAdmission=false){
      if(!c||c.closed||c.ending||c.voicemailDetected||c.hold||c.transferred||c.handoffPending||c.handoffAnnouncement||c.prepareRequested||closing)return;
      c.silenceClock.pause(Date.now());
      c.workerRetryPending=false;
      c.rejectedAdmission=undefined;
      // A new turn must not inherit the previous epoch's partial frame.
      reportPlayback();
      const completedTurnId=c.completedTurnId;
      c.outputCarry=Buffer.alloc(0);c.turnWrittenBytes=0;
      const epoch=++c.epoch;c.controller?.abort();const abort=new AbortController();c.controller=abort;c.processing=true;c.playbackReady=false;c.synthesisDone=false;c.playbackReported=false;c.renderedThisTurn=false;c.lastVoiceTurnId=undefined;c.turnText='';c.afterPlaybackReply=undefined;c.openingTurn=payload.opening===true;c.introductionTurn=false;
      c.turnTiming=recognition?{...recognition,epoch,stages:{}}:undefined;
      if(payload.text?.trim())c.openingResponse.response();
      let requestedTurnId,sourceBytes=0,doneTurnId,workerTimeout,admissionExhausted=false;
      const watchWorker=()=>{
        clearTimeout(workerTimeout);
        workerTimeout=setTimeout(()=>{
          if(c.epoch!==epoch||abort.signal.aborted||closing)return;
          if(c.prepareRequested||c.handoffPending||c.transferred||c.hold){abort.abort();return;}
          void endCustomerCall(true,'audio_bridge_failure',sourceBytes?'worker_pcm_stalled':'worker_no_pcm');
        },30000);
        workerTimeout.unref();
      };
      watchWorker();
      try{
        let response;
        for(let attempt=0;;attempt++){
          if(abort.signal.aborted||closing||c.epoch!==epoch||c.ending||c.hold||c.transferred||c.handoffPending||c.prepareRequested)return;
          requestedTurnId=crypto.randomUUID();
          if(c.turnTiming?.epoch===epoch){
            c.turnTiming.turnId=requestedTurnId;
            c.turnTiming.dispatchedAt??=Date.now();
          }
          response=await callback({action:'turn',eventId:requestedTurnId,externalCallId:c.externalCallId,callId:c.callId,completedTurnId,...payload},abort.signal);
          if(response.status!==409)break;
          const state=await response.json().catch(()=>({}));
          // Rejected admissions have their own event records. Retry with a
          // new ID only when the server says the turn was not admitted.
          if((state.retryable||state.code==='BUSY')&&!state.handoffPending){
            if(attempt>=8){
              admissionExhausted=true;
              throw Error('Voice turn admission retry exhausted');
            }
            await delay(Math.min(1000,150*(attempt+1)),undefined,{signal:abort.signal});
            continue;
          }
          if(state.handoffPending||state.error==='Call is no longer handled by AI'||state.error==='Another voice turn is still finishing'){
            logger('Voice turn deferred during handoff or an existing turn; customer call preserved');return;
          }
          break;
        }
        if(!response.ok||!response.body)throw Error('Voice turn failed');
        if(c.completedTurnId===completedTurnId)c.completedTurnId=undefined;
        const workerRevision=response.headers.get('x-shahvex-flow-revision');if(workerRevision&&workerRevision!=='missing'){c.voiceFlowRevision=workerRevision;logger('Active call voice flow revision: '+workerRevision);}
        let text='';const downsampler=createTelephoneDownsampler(),decoder=new TextDecoder();
        const consume=line=>{if(!line.trim()||c.ending||c.closed||c.epoch!==epoch)return;const e=JSON.parse(line);if(e.type==='error')throw Error('Shared voice engine error');if(e.type==='timing'&&e.stage==='flow-ready'){if(c.voiceFlowRevision!==e.revision)logger('Active call voice flow revision: '+String(e.revision||'missing'));c.voiceFlowRevision=e.revision;}
          if(e.type==='timing'&&e.turnId===requestedTurnId&&c.turnTiming?.epoch===epoch&&
             ['first-speakable-phrase','first-complete-sentence','first-pcm-received'].includes(e.stage)){
            c.turnTiming.stages[e.stage]=Date.now()-c.turnTiming.speechEndAt;
          }
          if(e.type==='introduction'&&e.turnId===requestedTurnId)c.introductionTurn=true;
          if(e.type==='end-offer'&&e.turnId===requestedTurnId)c.endOfferTurn=e.turnId;
          if(e.type==='handoff-announcement'&&e.turnId===requestedTurnId){
            c.handoffAnnouncement=e.turnId;c.priorityPauseEpoch=undefined;
            c.handoffPlaybackStarted=false;
          }
          if(e.type==='pcm'){
            if(e.turnId!==undefined&&e.turnId!==requestedTurnId)return;
            if(e.sampleRate!==24000)throw Error('Unexpected voice sample rate');
            const pcm=Buffer.from(e.data,'base64');sourceBytes+=pcm.length;
            if(pcm.length){
              c.workerFailureAt=undefined;
              watchWorker();
              if(c.turnTiming?.epoch===epoch)c.turnTiming.firstPcmAt??=Date.now();
            }
            const down=downsampler.push(pcm);c.outputCarry=Buffer.concat([c.outputCarry,down]);
            while(c.outputCarry.length>=320){c.queue.push(c.outputCarry.subarray(0,320));c.outputCarry=c.outputCarry.subarray(320);}
            if(c.queue.length>3000)throw Error('Voice playback queue exceeded limit');
          }
          if(e.type==='user'&&typeof e.text==='string'&&e.text.trim()){c.answerDetector?.transcript(e.text,false);if(!c.answerDetector?.ownsVoicemail&&machineHeard(e.text)){stopForVoicemail();return;}credibleSpeech();}
          if(e.type==='business-outcome')c.businessOutcome=true;
          if(e.type==='question-disposition')c.silenceClock.reset();
          if(e.type==='delta'&&typeof e.text==='string')c.turnText+=e.text;
          if(e.type==='done')doneTurnId=e.turnId===requestedTurnId?e.turnId:undefined;
          if(e.type==='end_call'){
            if(e.reason==='voicemail'){
              if(!c.answerDetector?.ownsVoicemail)stopForVoicemail();
              return;
            }
            if(e.reason==='no_response'&&c.answerDetector?.ownsSilence)return;
            if(e.immediate===true){void endCustomerCall(e.reason!=='abusive_language',e.reason==='abusive_language'?'abusive_language':'customer_request');return;}
            c.endAfterPlayback=true;c.noResponseEnding=e.reason==='no_response';
          }
        };
        for await(const chunk of response.body){
          if(c.epoch!==epoch||closing)throw Error('Cancelled');
          text+=decoder.decode(chunk,{stream:true});
          let at;
          while((at=text.indexOf('\n'))>=0){
            consume(text.slice(0,at));text=text.slice(at+1);
          }
          // Apply backpressure between reads so a terminal control event in
          // the chunk already received can clear PCM without waiting for drain.
          while(c.queue.length>=playbackHighWaterFrames){
            if(c.epoch!==epoch||closing||c.ending)throw Error('Cancelled');
            await delay(20,undefined,{signal:abort.signal});
          }
        }
        if(c.epoch!==epoch||abort.signal.aborted||closing)return;
        text+=decoder.decode();if(text.trim())consume(text);
        if(c.epoch!==epoch||abort.signal.aborted||closing)return;
        if(c.turnText.trim()&&!sourceBytes)throw Error('Voice output contained no PCM');
        c.lastVoiceTurnId=doneTurnId;
        c.synthesisDone=true;
        if(c.outputCarry.length){const tail=Buffer.alloc(320);c.outputCarry.copy(tail);c.queue.push(tail);c.outputCarry=Buffer.alloc(0);}
        if(!c.endAfterPlayback&&!c.handoffAnnouncement&&(payload.audio||payload.text))event(c,'retry-sync');
      }catch(error){
        if(c.epoch===epoch&&!closing&&!abort.signal.aborted){
          if(c.handoffAnnouncement===requestedTurnId)c.handoffAnnouncement=undefined;
          if(c.endOfferTurn===requestedTurnId){c.endOfferTurn=undefined;c.endOfferReply=undefined;}
          c.lastSpeechIssue='audio_turn_failed';
          c.playbackReported=true;c.queue.length=0;c.outputCarry=Buffer.alloc(0);
          logger(`Voice output failed call ${c.callId} turn ${requestedTurnId} epoch ${epoch}: ${sourceBytes} source PCM bytes, ${c.turnWrittenBytes} written`);
          c.workerFailureAt??=Date.now()+30000;
          if(admissionExhausted&&payload.text&&!retryingAdmission)c.rejectedAdmission={payload,recognition,epoch};
          c.workerRetryPending=admissionExhausted?Boolean(c.rejectedAdmission):!payload.retryFailedSpeech;
        }
      }finally{
        clearTimeout(workerTimeout);
        if(abort.signal.aborted&&requestedTurnId)logger(`Voice output cancelled call ${c.callId} turn ${requestedTurnId} epoch ${epoch}: ${sourceBytes} source PCM bytes`);
        if(c?.epoch===epoch){
          c.synthesisDone=true;c.processing=false;c.lastSpeech=Date.now();
        }
      }
    }
    async function initialize(uuid){
      if(audioIds.has(uuid))throw Error('Audio UUID already connected');
      audioIds.set(uuid,null);claimedUuid=uuid;
      const takeRegistration=()=>{
        const value=registered.get(uuid);
        if(value?.expires>Date.now())return value;
      };
      let metadata=takeRegistration();
      if(!metadata&&!resolveRegistration&&!testOnly){
        for(let attempt=0;attempt<8&&!metadata&&!closing;attempt++){
          await delay(125);
          metadata=takeRegistration();
        }
      }
      if(closing)return;
      if(!metadata&&testOnly&&allowUnregisteredManualAudio)metadata={uuid,externalCallId:'manual-'+uuid.replaceAll('-',''),agentUser:'manual-test',expires:Date.now()+30000};
      if(!metadata&&!testOnly){
        let resolved;
        for(let attempt=0;attempt<4&&!closing;attempt++){
          if(resolveRegistration){
            try{resolved=await resolveRegistration(uuid,admissionAbort.signal);}
            catch(error){metadata=takeRegistration();if(!metadata&&!closing)throw error;}
          }
          else {
            const reply=await callback({action:'resolve-prefix',eventId:crypto.randomUUID(),externalCallId:'direct-'+uuid.replaceAll('-',''),audioUuid:uuid},admissionAbort.signal);
            if(reply.ok)resolved=await reply.json();
            else {
              const state=await reply.json().catch(()=>({}));
              if(reply.status<500&&reply.status!==429&&!state.retryable)throw Error('Audio line resolution rejected; verify assignment, readiness and route');
            }
          }
          metadata=takeRegistration();
          if(metadata||resolved||closing)break;
          await delay(250*(attempt+1));
        }
        if(!metadata&&resolved?.uuid===uuid&&resolved.audioUuid===uuid&&/^[\w-]{2,20}$/.test(resolved.agentUser||'')&&/^[\w-]{16,40}$/.test(resolved.externalCallId||'')&&!String(resolved.externalCallId).startsWith('manual-'))metadata={...resolved,expires:Date.now()+30000};
      }
      if(closing)return;
      if(!metadata||metadata.expires<Date.now())throw Error('Unregistered AudioSocket call');
      registered.delete(uuid);
      audioIds.set(uuid,metadata);
      // One AudioSocket leg per admitted call, including across bridge restarts.
      if(fs.existsSync(path.join(spoolDir,`${metadata.externalCallId}.handoff.json`)))throw Error('Call already used its audio leg');
      if(startingCalls.has(metadata.externalCallId)||[...calls.values()].some(call=>call.externalCallId===metadata.externalCallId))throw Error('Call already has an audio leg');
      startingCalls.add(metadata.externalCallId);
      try {
      const admission={action:'connected',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,agentUser:metadata.agentUser,...(metadata.audioUuid?{audioUuid:metadata.audioUuid}:{}),...(metadata.asteriskUniqueid?{asteriskUniqueid:metadata.asteriskUniqueid}:{}),...(metadata.asteriskLinkedid?{asteriskLinkedid:metadata.asteriskLinkedid}:{})};
      admissionStage='assignment';
      let response,data;
      for(let attempt=0;;attempt++){
        try{response=await callback(admission,admissionAbort.signal);}catch(error){if(attempt>=2||closing)throw error;await delay(250*(attempt+1));continue;}
        data=await response.json().catch(()=>({}));
        const retryable=!data.callId&&(response.status>=500||response.status===429||
          (response.status===409&&data.retryable===true));
        if(!retryable||attempt>=2||closing)break;
        await delay(250*(attempt+1));
      }
      if(!response.ok){if(data.callId)persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,callId:data.callId});throw Error('Answered call was not accepted');}
      if(!data.callId||data.status==='FAILED'||data.status==='COMPLETED')throw Error('Call unavailable');
      fs.writeFileSync(path.join(spoolDir,`${metadata.externalCallId}.handoff.json`),JSON.stringify({callId:data.callId,externalCallId:metadata.externalCallId}),{mode:0o600});
      c={...metadata,socket,callId:data.callId,admissionMs:Date.now()-acceptedAt,queue:[],outputCarry:Buffer.alloc(0),frames:[],pre:[],preRoll:[],voiceFrames:0,silent:0,started:Date.now(),lastSpeech:Date.now(),silenceClock:new CustomerSilence(),openingResponse:new OpeningResponseTimeout(30000),processing:false,hold:false,epoch:0,captureInput:Buffer.alloc(0),recorder:createAiRecording(recordingDir,uuid)};calls.set(uuid,c);
      const connected = Date.parse(data.connectedAt);
      c.noCustomerSpeechOrigin = Number.isFinite(connected) ? Math.min(Date.now(), connected) : c.started;
      c.noCustomerSpeechOriginSource = Number.isFinite(connected) ? 'connected_at' : 'media_admission';
      c.resumeAfterHandoffFailure=()=>void turn({handoffFailed:true});
      if(closing){callAnswer?.recordUnavailable(c.callId,c.noCustomerSpeechOrigin,'call_closed_before_media_ready');finishRecording(c);event(c,'ended',{durationSeconds:0});calls.delete(uuid);return;}
      fs.writeFileSync(path.join(spoolDir,`${uuid}.call.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId,agentUser:c.agentUser}),{mode:0o600});
      if(createSpeechScorer)c.initialAudio=initialAudio(c.noCustomerSpeechOrigin,createSpeechScorer());
      c.limit=data.maxCallDurationSeconds||0;
      setScriptLimit(data.businessQuestionCount);
      if(data.mediaReady!==true){admissionStage='media_ready';const ready=await callback({action:'media-ready',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId},admissionAbort.signal);if(!ready.ok)throw Error('Media reservation was not activated');await ready.arrayBuffer();}
      if(closing||admissionAbort.signal.aborted)return;
      c.mediaReady=true;
      const canClassifyHangup=decision=>!(c.ending||c.closed||c.hold||c.transferred||c.handoffPending||
        c.nativeTransferPending||c.syncHandoffPending||c.handoffAnnouncement||c.prepareRequested||closing||
        decision.classification==='SILENCE'&&(recentVoice(Date.now())||c.recognizing||c.frames.length||
          decision.signal==='no_speech'&&c.callerSpoke));
      c.answerDetector=callAnswer?.start(c.callId,c.noCustomerSpeechOrigin,(decision,disposition)=>{
        if(!canClassifyHangup(decision))return false;
        void endCustomerCall(false,'call_answer_detection',decision.signal,disposition)
          .catch(()=>callAnswer.log(c.callId,'hangup_result',{result:'callback_error'}));
        return c.ending;
      },canClassifyHangup);
      clearTimeout(admissionTimeout);
      c.waitingCustomer=data.first==='customer';
      if(c.waitingCustomer)c.customerFirstStartedAt=Date.now();
      if(!c.waitingCustomer)void turn({opening:true}); // Honor the assigned first-speaker setting.
      if(!testOnly)event(c,'retry-sync');
      } finally { startingCalls.delete(metadata.externalCallId); }
    }
    let input=Promise.resolve();
    socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);if(pending.length>128000){socket.destroy();return;}
      while(pending.length>=3){const size=pending.readUInt16BE(1);if(pending.length<3+size)break;const type=pending[0],payload=Buffer.from(pending.subarray(3,3+size));pending=pending.subarray(3+size);
        input=input.then(async()=>{
          if(closing||socket.destroyed)return;
          if(type===0){remoteHangup=true;socket.end();return;}
          if(type===1){
            if(c||payload.length!==16)throw Error('Invalid AudioSocket identifier');
            admissionStage='audio_linkage';
            const hex=payload.toString('hex');initializing=true;
            try{await initialize(`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`);}
            finally{initializing=false;if(closing&&claimedUuid)audioIds.delete(claimedUuid);}
            return;
          }
          if(type===3)return; // DTMF is not invented customer speech.
          if(type!==0x10||!c||payload.length%2)throw Error('Expected PCM16 8 kHz mono');
          // Empty AudioSocket heartbeats are not audio. They must not prevent
          // the wall-clock finalizer from releasing a buffered utterance.
          if(!payload.length)return;
          c.lastInputAt=Date.now();
          c.inputPcmBytes=(c.inputPcmBytes||0)+payload.length;
          if(!c.handoffPending&&!c.transferred)c.captureInput=Buffer.concat([c.captureInput,payload]).subarray(-16000);
          const playback=c.writing||(c.lastOutputAt!==undefined&&c.lastInputAt-c.lastOutputAt<playbackBufferMs+20);
          c.answerDetector?.audio(payload,Boolean(playback||c.hold||c.handoffPending||c.transferred));
          for(let at=0;at<payload.length;at+=320)
            receiveSpeech(payload.subarray(at,at+320));
        }).catch(error=>{if(c&&!closing)void endCustomerCall(true,initializing?admissionStage:'audio_protocol');else if(!closing){logger(`Audio admission failed: ${admissionStage}`);socket.destroy();}});
      }
    });
    // Silence suppression can stop input packets completely after speech/noise.
    // Finalize from wall-clock inactivity as well as received silent PCM frames.
    const agentSpeaking=()=>Boolean(c.processing||c.queue.length||c.writing);
    function logSpeech(reason, audio, accepted=false, extra={}){
      if(!speechConfig.debug)return;
      logger(`Speech decision ${JSON.stringify({
        callId:c.callId,accepted,reason,...audio,
        dbfs:Number.isFinite(audio.dbfs)?Number(audio.dbfs.toFixed(1)):null,...extra,
      })}`);
    }
    function flushNoise(){
      if(!c?.gatedNoise)return;
      logSpeech('below_energy_gate',c.gatedNoise);
      c.gatedNoise=undefined;
    }
    function discardSpeechOnset(){
      if(c.voiceFrames)logSpeech('too_short_for_speech_onset',measureSpeech(c.pre));
      c.voiceFrames=0;
      c.pre=[];
    }
    const recentVoice = now => c.lastVoicedAt!==undefined && now-c.lastVoicedAt<endOfSpeechMs;
    function matchesPlayback(text){
      const words = value => String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ');
      const heard = words(text), played = words(c.turnText);
      return Boolean(c.lastOutputAt!==undefined&&heard&&played&&` ${played} `.includes(` ${heard} `));
    }
    function credibleSpeech(){
      c.callerSpoke=true;
      c.initialAudio?.recognize();
      c.openingResponse.response();
      c.silenceClock.speech();
    }
    function receiveSpeech(pcm){
      const ms=pcm.length/16;
      const preserveAudio=c.voiceFrames>0&&c.silent<speechHangoverMs;
      const frame=suppressNoise(pcm,agentSpeaking()?speechConfig:listeningSpeechConfig,preserveAudio);
      const {level,voiced}=frame;
      // Keep consonants below the energy gate in the recognition waveform.
      frame.audio=pcm;
      const playback = c.writing || (c.lastOutputAt!==undefined && c.lastInputAt-c.lastOutputAt<playbackBufferMs+20);
      // Mask audible playback overlap from the initial VAD without changing STT input.
      if(c.initialAudio&&!c.ending)c.initialAudio.receive(voiced&&!playback?pcm:Buffer.alloc(pcm.length),c.lastInputAt,voiced&&Boolean(playback));
      if(c.voicemailDetected||c.hold||c.transferred||c.handoffPending||c.handoffAnnouncement&&c.playbackReported||c.prepareRequested||c.ending)return;
      if(speechConfig.debug){
        if(!voiced&&Number.isFinite(level)){
          const noise=c.gatedNoise||{dbfs:-Infinity,durationMs:0,voicedMs:0};
          noise.dbfs=Math.max(noise.dbfs,level);
          noise.durationMs+=ms;
          c.gatedNoise=noise;
          if(noise.durationMs>=endOfSpeechMs)flushNoise();
        }else flushNoise();
      }
      if(voiced){
        if(!c.voiceFrames){
          c.speechOverlap=!c.endOfferTurn&&agentSpeaking();
          if(!c.callerSpoke&&playback)c.speechOverlap=true;
          c.pre=c.preRoll.slice();
        }
        c.lastVoicedAt=c.lastInputAt;
        if(c.callerSpoke&&c.frames.length)c.silenceClock.speech();
        c.openingResponse.voice(c.lastVoicedAt);
        c.inputVoicedMs=(c.inputVoicedMs||0)+ms;
        c.voiceFrames+=ms;
        c.silent=0;
      }else c.silent+=ms;
      // Keep raw leading audio for STT while retaining its original RMS classification.
      c.preRoll.push(frame);
      let preRollBytes=c.preRoll.reduce((total,entry)=>total+entry.audio.length,0);
      while(preRollBytes>speechPreRollBytes)preRollBytes-=c.preRoll.shift().audio.length;
      if(c.frames.length)c.frames.push(frame);
      else if(c.voiceFrames){
        c.pre.push(frame);
        if(c.voiceFrames>=speechConfig.onsetMs){
          if(c.callerSpoke){c.silenceClock.speech();c.customerHolding=false;}
          c.frames=c.pre;
          c.pre=[];
        }else if(c.silent>=speechConfig.onsetMs)discardSpeechOnset();
      }
      if(voiced&&c.frames.length)probePriority();
      if(c.frames.length&&(c.silent>=endOfSpeechMs||c.frames.reduce((n,b)=>n+b.audio.length,0)>=320000))finishUtterance();
    }
    async function listen(pcm,signal,marginMs=0){
      const samples=upsample(pcm);
      const margin=marginMs?Buffer.alloc(marginMs*32):undefined;
      const audio=wav(margin?Buffer.concat([margin,samples,margin]):samples).toString('base64');
      let response;
      try{
        response=await callback({action:'listen',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,audio},signal);
      }catch{return {error:'transport_error'};}
      if(!response.ok){
        void response.body?.cancel().catch(()=>{});
        return {error:'http_'+response.status};
      }
      try{return {heard:await response.json()};}
      catch{return {error:'invalid_response'};}
    }
    const canDecideSpeech=()=>!closing&&!c.closed&&!c.ending&&!c.hold&&!c.transferred&&
      !c.handoffPending&&(!c.handoffAnnouncement||!c.playbackReported)&&!c.nativeTransferPending&&!c.voicemailDetected&&!c.prepareRequested;
    async function interruptPlayback(){
      c.afterPlaybackReply=undefined;
      c.endOfferTurn=undefined;c.endOfferReply=undefined;
      c.stepInterruptions=(c.stepInterruptions||0)+1;
      c.interruptions=(c.interruptions||0)+1;
      c.playbackReady=false;c.epoch++;c.controller?.abort();c.processing=false;
      c.playbackReported=true;c.queue.length=0;c.outputCarry=Buffer.alloc(0);
      try{
        const interrupted=await callback({action:'interrupt',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId},AbortSignal.timeout(1200));
        if(!interrupted.ok)logger('Voice cancellation callback declined; retrying caller turn through normal admission');
        void interrupted.body?.cancel().catch(()=>{});
      }catch{logger('Voice cancellation callback unavailable; retrying caller turn through normal admission');}
    }
    const interruptsWithQuestion = text => isCustomerQuestion(text) || customerRequestsHuman(text);
    function probePriority(){
      if(c.handoffAnnouncement||c.endOfferTurn||!agentSpeaking()||c.recognizing||c.turnCarry)return;
      if(c.priorityProbe?.frames!==c.frames)c.priorityProbe={frames:c.frames,nextMs:speechConfig.priorityProbeMs};
      const probe=c.priorityProbe;
      if(probe.pausedEpoch===undefined&&c.speechOverlap&&c.voiceFrames>=bargeInVoicedMs){
        probe.pausedEpoch=c.epoch;
        c.priorityPauseEpoch=c.epoch;
      }
      if(probe.pending||probe.semanticPause||c.voiceFrames<probe.nextMs)return;
      probe.nextMs=c.voiceFrames+speechConfig.priorityProbeIntervalMs;
      const epoch=c.epoch,frames=c.frames.slice(),metrics=measureSpeech(frames);
      const abort=new AbortController();
      probe.pending=abort;
      void listen(Buffer.concat(frames.map(frame=>frame.audio)),AbortSignal.any([abort.signal,AbortSignal.timeout(3000)])).then(({heard,error})=>{
        if(c.frames!==probe.frames||!canDecideSpeech()||c.epoch!==epoch||!agentSpeaking())return;
        if(error){logSpeech(error,metrics,false,{stage:'priority_probe'});return;}
        const decision=speechDecision(heard,metrics,speechConfig,true);
        const detail={confidence:heard.confidence??null,words:decision.words,stage:'priority_probe'};
        if(matchesPlayback(heard.text))return;
        if(!decision.trusted||!decision.priority&&!interruptsWithQuestion(heard.text)){
          logSpeech(decision.accepted?'awaiting_endpoint':decision.reason,metrics,false,detail);
          return;
        }
        logSpeech('priority_pause',metrics,true,detail);
        probe.semanticPause=true;
        probe.pausedEpoch=epoch;
        c.priorityPauseEpoch=epoch;
      }).catch(()=>logSpeech('invalid_response',metrics,false,{stage:'priority_probe'})).finally(()=>{probe.pending=undefined;});
    }
    function finishUtterance(inputGap=false){
      if(!c||!c.frames.length||closing||c.closed||c.hold||c.voicemailDetected||c.ending||c.handoffPending||c.transferred)return;
      if(inputGap)c.inputGapFlushes=(c.inputGapFlushes||0)+1;
      const announcementAtEndpoint=c.handoffAnnouncement;
      const frames=c.frames,overlap=c.speechOverlap,endedVoiceAt=c.lastVoicedAt,endpointAt=Date.now();
      const priority=c.priorityProbe?.frames===frames?c.priorityProbe:undefined;
      priority?.pending?.abort();
      c.priorityProbe=undefined;
      const releasePause=()=>{
        if(priority?.pausedEpoch!==undefined&&c.priorityPauseEpoch===priority.pausedEpoch)c.priorityPauseEpoch=undefined;
      };
      c.frames=[];c.voiceFrames=0;c.silent=0;c.pre=[];
      c.recognizing=(c.recognizing||0)+1;
      let released=false;const releaseRecognition=()=>{if(!released){released=true;c.recognizing=Math.max(0,(c.recognizing||1)-1);}};
      c.speechDecisions=(c.speechDecisions||Promise.resolve()).then(async()=>{
        if(!canDecideSpeech())return;
        const source=[...(c.turnCarry?.frames||[]),...frames];
        const duringPlayback=Boolean(c.turnCarry?.overlap||overlap);
        c.turnCarry=undefined;c.turnHoldUntil=undefined;
        let sourceBytes=source.reduce((n,b)=>n+b.audio.length,0);
        while(sourceBytes>320000)sourceBytes-=source.shift().audio.length;
        const metrics=measureSpeech(source);
        const carry=()=>{c.turnCarry={frames:source,overlap:duringPlayback};c.turnHoldUntil=Date.now()+endOfSpeechMs;};
        if(c.recognizing>1&&priority?.pausedEpoch===undefined){carry();return;}
        if(metrics.voicedMs<speechConfig.onsetMs){logSpeech('below_energy_gate',metrics);return;}
        const pcm=Buffer.concat(source.map(frame=>frame.audio),sourceBytes);
        const probeAt=Date.now();
        const recognitionAbort=new AbortController();
        c.recognitionAbort=recognitionAbort;
        const recognitionSignal=ms=>AbortSignal.any([recognitionAbort.signal,AbortSignal.timeout(ms)]);
        // Playback overlap keeps the existing stricter echo and interruption gates.
        const speechConfirmed=Boolean(!duringPlayback&&!agentSpeaking()&&createSpeechScorer&&
          await Promise.race([
            hasSpeech(pcm,createSpeechScorer()).catch(()=>false),
            delay(500,false,{signal:recognitionAbort.signal,ref:false}).catch(()=>false),
          ]));
        if(!canDecideSpeech())return;
        if(speechConfirmed)credibleSpeech();
        const result=await listen(pcm,recognitionSignal(3000));
        if(!canDecideSpeech())return;
        const heard=result.heard||{};
        let speaking=agentSpeaking();
        const decisionConfig=duringPlayback||speaking?speechConfig:listeningSpeechConfig;
        let decision=speechDecision(heard,metrics,decisionConfig,!c.endOfferTurn&&(duringPlayback||speaking));
        // Phone audio can turn a clipped insult into a polite acknowledgment.
        // Require two matching abuse decodes before overriding the primary transcript.
        if(/^(?:oh[, ]+)?(?:thank you|thanks)(?:[,.! ]+(?:sir|ma['’]?am))?[.!? ]*$/i.test(heard.text?.trim()||'')){
          const retry=await listen(pcm,recognitionSignal(1500),250);
          if(!canDecideSpeech())return;
          if(isDirectedAbuse(retry.heard?.text)){
            const check=await listen(pcm,recognitionSignal(1500),450);
            if(!canDecideSpeech())return;
            const normalize=value=>String(value||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ');
            const recovered=check.heard?.text;
            if(isDirectedAbuse(recovered)&&normalize(retry.heard.text)===normalize(recovered)&&
               !((duringPlayback||speaking)&&matchesPlayback(recovered))&&
               speechDecision({text:recovered},metrics,speechConfig,false).trusted){
              void endCustomerCall(false,'abusive_language');
              return;
            }
          }
        }
        const abuse = isDirectedAbuse(heard.text) && !((duringPlayback||speaking)&&matchesPlayback(heard.text));
        let confirmedAbuse = abuse && decision.trusted;
        if(abuse&&!confirmedAbuse&&decision.reason==='low_confidence'){
          const retry=await listen(pcm,recognitionSignal(1500),250);
          if(!canDecideSpeech())return;
          const repeated=retry.heard;
          // Require a second decode before taking action on uncertain speech.
          confirmedAbuse=Boolean(repeated&&isDirectedAbuse(repeated.text)&&
            !((duringPlayback||speaking)&&matchesPlayback(repeated.text))&&
            (speechDecision(repeated,metrics,speechConfig,false).trusted ||
             String(heard.text).toLowerCase().replace(/[^\p{L}]+/gu,' ').trim()===
               String(repeated.text).toLowerCase().replace(/[^\p{L}]+/gu,' ').trim() &&
             speechDecision({text:repeated.text},metrics,speechConfig,false).trusted));
        }
        if(confirmedAbuse){
          void endCustomerCall(false,'abusive_language');
          return;
        }
        const overlappingReply = !abuse&&(duringPlayback||speaking)&&
          decision.reason==='low_confidence'&&heard.text?.trim()&&
          interruptionKind(heard.text)==='interrupt'&&!isGreetingOnly(heard.text)&&!matchesPlayback(heard.text);
        if(overlappingReply&&!c.frames.length&&c.recognizing===1){
          const retry=await listen(pcm,recognitionSignal(1200),250);
          if(!canDecideSpeech())return;
          const words=text=>String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ');
          if(words(heard.text)===words(retry.heard?.text)&&!matchesPlayback(retry.heard?.text))
            decision=speechDecision({text:heard.text},metrics,speechConfig,true);
        }
        const openingReply=c.waitingCustomer&&c.epoch===0||
          c.epoch===1&&c.openingTurn&&c.introductionTurn&&c.playbackReported;
        const shortReply = value => {
          const normalized = String(value || '').trim().toLowerCase().replace(/[.!?]+$/,'');
          if(/^(?:ok|okay)$/.test(normalized))return 'acknowledgment';
          const words = normalized.split(/[,\s]+/);
          if(words.length===2&&words[0]===words[1])return shortAnswerPolarity(words[0]);
          return shortAnswerPolarity(normalized);
        };
        const confirmedShortReply = shortReply(heard.text);
        if(!abuse&&speechConfirmed&&!speaking&&!c.endOfferTurn&&!c.handoffAnnouncement&&decision.reason==='low_confidence'&&
          !c.frames.length&&c.recognizing===1){
          const epoch=c.epoch;
          // The recognizer's word score can be low even for clear phone audio.
          // Require a second decode with quiet margins to agree before using the text.
          const retryAt=Date.now();
          const retry=await listen(pcm,recognitionSignal(openingReply?3000:1000),250);
          if(!canDecideSpeech()||c.epoch!==epoch)return;
          speaking=agentSpeaking();
          const words=text=>String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ');
          const confirmed=words(heard.text);
          const retryText=retry.heard?.text;
          const polarity=shortAnswerPolarity(heard.text);
          const compatible=Boolean(polarity&&polarity===shortAnswerPolarity(retryText));
          const agrees=Boolean(confirmed&&confirmed===words(retryText));
          const sameShortReply = Boolean(confirmedShortReply && confirmedShortReply===shortReply(retryText));
          if(!speaking&&(agrees||(openingReply?compatible:sameShortReply))&&!explicitlyEndsCall(heard.text)&&
            !isDirectedAbuse(heard.text)&&!isTransferOffer({role:'assistant',content:c.turnText||''})){
            decision=speechDecision({text:heard.text},metrics,decisionConfig,false);
            logSpeech('corroborated_transcript',metrics,Boolean(decision.accepted),{confidence:heard.confidence,retryConfidence:retry.heard?.confidence,compatible:compatible&&!agrees,retryMs:Date.now()-retryAt});
          }
        }
        if(result.error){
          c.speechProbeFailures=(c.speechProbeFailures||0)+1;
          c.lastSpeechIssue=result.error;
          logSpeech(result.error,metrics);
          return;
        }
        if((duringPlayback||speaking)&&matchesPlayback(heard.text)){
          logSpeech('playback_echo',metrics);
          return;
        }
        if(c.handoffAnnouncement){
          if(c.handoffAnnouncement!==announcementAtEndpoint||!decision.trusted)return;
          const text=heard.text;
          const stop=explicitlyEndsCall(text)||withdrawsHumanRequest(text)||/^(?:no|nope|not now)[.! ]*$/i.test(text.trim());
          if(!stop&&(!c.handoffPlaybackStarted||!isCustomerQuestion(text)))return;
          const interruptedHandoff=c.handoffAnnouncement;
          c.handoffAnnouncement=undefined;
          c.transferDiscussion=true;
          await interruptPlayback();
          if(!canDecideSpeech())return;
          releaseRecognition();
          void turn({text,interruptedHandoff});
          return;
        }
        const detail={confidence:heard.confidence??null,words:decision.words};
        const questionInterrupt=decision.trusted&&interruptsWithQuestion(heard.text);
        if(priority?.semanticPause&&(!decision.trusted||!decision.priority&&!questionInterrupt)){
          logSpeech('priority_unconfirmed_resume',metrics,false,{...detail,finalReason:decision.reason});
          return;
        }
        if(decision.trusted||speechConfirmed)c.answerDetector?.transcript(heard.text,!duringPlayback&&!speaking);
        if(decision.trusted&&(decision.accepted||decision.words>=2)&&!c.answerDetector?.ownsVoicemail&&machineHeard(heard.text)){
          logSpeech('voicemail',metrics,false,detail);stopForVoicemail();return;
        }
        // Preserve explicit transfer consent until the offer finishes playing.
        const acceptsOffer=decision.reason==='backchannel'&&affirmativeTransferConsent(heard.text)&&isTransferOffer({role:'assistant',content:c.turnText||''});
        const continuing=c.frames.length||c.recognizing>1||c.lastVoicedAt>endedVoiceAt&&c.voiceFrames>=speechConfig.onsetMs/2;
        if(!decision.priority&&continuing&&(decision.accepted||['too_few_words','too_short_to_interrupt'].includes(decision.reason))){
          logSpeech('waiting_for_continuation',metrics,false,detail);carry();return;
        }
        // Audio that is too brief to interrupt can still be a complete caller turn.
        const deferUntilPlayback = speaking && decision.trusted &&
          ['too_few_words','too_short_to_interrupt'].includes(decision.reason) &&
          !matchesPlayback(heard.text);
        const shortAnswerInterrupt=deferUntilPlayback&&!isGreetingOnly(heard.text);
        if(!decision.accepted&&!acceptsOffer&&!deferUntilPlayback&&!questionInterrupt){logSpeech(decision.reason,metrics,false,detail);return;}
        if(!speaking&&!c.endOfferTurn&&interruptionKind(heard.text)==='filler'&&!isListeningSignal(heard.text)){
          logSpeech('filler_transcript',metrics,false,detail);return;
        }
        if (decision.trusted && !isGreetingOnly(heard.text) &&
            (isCustomerQuestion(heard.text) || interruptionKind(heard.text)==='interrupt'))
          c.lastMeaningfulTurnAt=Date.now();
        c.waitingCustomer=false;c.openingResponse.response();
        credibleSpeech();
        c.customerHolding=asksToWait(heard.text);
        if(c.noResponseEnding){c.endAfterPlayback=false;c.noResponseEnding=false;}
        const recognition={speechEndAt:endedVoiceAt,endpointAt,probeAt,recognizedAt:Date.now()};
        if(c.endOfferTurn){
          logSpeech('after_end_offer',metrics,false,detail);
          c.endOfferReply={payload:{text:heard.text},recognition};
          return;
        }
        if(speaking&&(acceptsOffer||!questionInterrupt&&!shortAnswerInterrupt&&(deferUntilPlayback||!decision.priority&&(c.stepInterruptions||0)>=(c.hasCompletedSpeech?1:2)))){
          logSpeech(acceptsOffer?'transfer_consent_deferred':'interruption_limit',metrics,false,detail);
          c.afterPlaybackReply={text:heard.text,recognition,epoch:c.epoch};
          return;
        }
        if(speaking&&!decision.priority&&!c.introductionTurn&&isGreetingOnly(heard.text)){
          logSpeech('greeting_during_playback',metrics,false,detail);
          return;
        }
        if(speaking){
          logSpeech(decision.reason,metrics,true,detail);
          await interruptPlayback();
        }else logSpeech('customer_turn',metrics,false,detail);
        if(!canDecideSpeech())return;
        releaseRecognition();
        void turn({text:heard.text},recognition);
      }).catch(()=>logger('Speech decision unavailable; preserving current playback')).finally(()=>{
        c.recognitionAbort=undefined;
        releasePause();
        releaseRecognition();
      });
    }
    function machineHeard(text){
      const recent=c.machineHeardTexts||[];
      const detected=isVoicemailGreeting(text,recent);
      if(text&&recent.at(-1)!==text)c.machineHeardTexts=[...recent,text].slice(-3);
      return detected;
    }
    function stopForVoicemail(){
      if(!c||c.ending||c.closed||closing)return;
      c.voicemailDetected=true;c.epoch++;c.controller?.abort();c.playbackReported=true;c.queue.length=0;c.outputCarry=Buffer.alloc(0);
      c.playbackReady=false;c.processing=false;c.frames=[];c.pre=[];
      c.turnCarry=undefined;c.turnHoldUntil=undefined;
      c.endAfterPlayback=false;c.noResponseEnding=false;
      void endCustomerCall(true,'voicemail_detected');
    }
    async function endCustomerCall(localDeadline=false,reason='',evidence=reason,disposition){
      const absoluteDeadline=nativeDeadline(reason);
      const nativeOnly=absoluteDeadline||answerDetection(reason)||reason==='call_duration_limit'||reason==='abusive_language'||reason==='customer_silence_timeout';
      if(!c||c.ending||closing||c.transferred||(!absoluteDeadline&&(c.handoffPending||c.nativeTransferPending||
         c.handoffAnnouncement&&(c.playbackReported||reason!=='abusive_language')||c.prepareRequested)))return;
      const value={action:'hangup',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId};
      if(reason){
        const endReason=(absoluteDeadline||answerDetection(reason))?reason:['voicemail_detected','customer_request','call_duration_limit','no_speech_timeout','audio_link_timeout','audio_bridge_failure','no_business_outcome_timeout','customer_silence_timeout','abusive_language'].includes(reason)?reason:'media_pipeline_failure';
        value.endInitiation={reason:endReason,decidedAt:new Date().toISOString(),evidence,...(disposition?{disposition}:{})};
      }
      // Persist classifier actions before mutating playback state so a disk error
      // leaves the call live. The existing delivery path starts after cancellation.
      if(answerDetection(reason))persistEvent(value);
      c.ending=true;
      c.silenceClock.reset();
      if(nativeOnly){
        try{
          c.epoch++;c.controller?.abort();c.recognitionAbort?.abort();c.priorityProbe?.pending?.abort();
        }finally{
          c.playbackReported=true;c.queue.length=0;c.outputCarry=Buffer.alloc(0);c.frames=[];c.pre=[];
          c.turnCarry=undefined;c.processing=false;c.afterPlaybackReply=undefined;c.endOfferReply=undefined;
          if(answerDetection(reason)){c.writing=false;c.playbackReady=false;}
        }
        if(absoluteDeadline){
          c.silenceHangupPending=true;
          c.initialAudio?.close();
          clearTimeout(c.syncRetryTimer);
          c.syncWanted=false;
          c.workerRetryPending=false;
          c.rejectedAdmission=undefined;
          c.workerFailureAt=undefined;
          c.turnHoldUntil=undefined;
          logger(`Native hangup requested for call ${c.callId}: ${reason}; ${evidence}`);
        }
        if(!answerDetection(reason))persistEvent(value);
        void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`),true);
        // The direct audio leg can close while the website verifies the native customer state.
        if(c.externalCallId.startsWith('direct-')&&['customer_silence_timeout','call_duration_limit'].includes(reason))
          releaseAiMedia(c);
        return;
      }
      if(localDeadline){
        // Closing an unanswered direct AI audio leg ends its dialplan immediately.
        // Persist/retry provider reconciliation without keeping the caller in silence.
        c.epoch++;c.controller?.abort();c.playbackReported=true;c.queue.length=0;c.outputCarry=Buffer.alloc(0);c.frames=[];c.pre=[];c.processing=false;
        persistEvent(value);void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`),true);
        logger(`Closing call ${c.callId}: ${value.endInitiation?.reason || 'bridge termination'}`);
        socket.end(packet(0));const deadline=setTimeout(()=>socket.destroy(),500);deadline.unref();
        return;
      }
      persistEvent(value);
      void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`),true);
    }
    function setScriptLimit(count){
      if(Number.isInteger(count)&&count>=1&&count<=3)
        c.scriptLimitMs=Math.min(c.scriptLimitMs??Infinity,count<=2?90000:120000);
    }
    let checkingState=false;
    const stateWatch=setInterval(async()=>{
      if(testOnly||!c||closing||c.closed||checkingState)return;checkingState=true;
      try{const response=await callback({action:'call-state',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId},AbortSignal.timeout(5000));if(response.ok){const state=await response.json();if(closing||calls.get(c.uuid)!==c)return;
        if(state.customerEnded||state.transferSubmitted)releaseAiMedia(c);
        else {
          const connected = Date.parse(state.connectedAt);
          if(Number.isFinite(connected)&&c.noCustomerSpeechOriginSource!=='connected_at'){
            c.noCustomerSpeechOrigin=Math.min(Date.now(),connected);
            c.noCustomerSpeechOriginSource='connected_at';
            c.answerDetector?.connectedAt(connected);
          }
          c.nativeTransferPending=Boolean(state.awaitingTransfer);
          c.businessOutcome ||= state.businessOutcome===true;
          const count=state.businessQuestionCount;
          setScriptLimit(count);
          if(Number.isInteger(count)&&count>3&&c.businessDeadline===undefined){
            const connected=Date.parse(state.connectedAt);
            c.businessOrigin=Number.isFinite(connected)?Math.min(Date.now(),connected):c.started;
            c.businessDeadline=c.businessOrigin+120000;
          }
        }}}
      catch{/* A network failure never proves a customer has ended. */}finally{checkingState=false;}
    },1500);stateWatch.unref();
    const silence=setInterval(()=>{
      if(!c?.mediaReady||c.ending||c.voicemailDetected||c.transferred||closing)return;
      const now=Date.now();
      if(c.initialAudio?.speech&&!c.callerSpoke)credibleSpeech();
      if(c.waitingCustomer&&!c.callerSpoke){
        const elapsed=now-c.customerFirstStartedAt;
        const speechPending=recentVoice(now)||c.frames.length||c.recognizing||c.turnCarry;
        if(!c.hold&&!c.handoffPending&&!c.prepareRequested&&!c.nativeTransferPending){
          if(elapsed>=customerFirstDeadlineMs&&!c.answerDetector?.ownsSilence){
            // Let speech near the cutoff finish recognition before deciding.
            if(!speechPending||elapsed>=customerFirstDeadlineMs+6500){
              void endCustomerCall(testOnly,testOnly?'no_speech_timeout':'no_customer_speech_deadline',`origin=media_ready; elapsed_ms=${elapsed}`);
              return;
            }
          }else if(elapsed<customerFirstDeadlineMs&&elapsed>=customerFirstIntroMs&&!speechPending&&c.epoch===0){
            void turn({opening:true,silenceOpening:true});
          }
        }
      }
      const initial=c.initialAudio?.evaluate(now);
      if(initial) {
        logger(`Initial caller audio diagnostic call ${c.callId}: ${JSON.stringify(initial)}`);
        if (enforceInitialSilence && !c.answerDetector?.ownsSilence && !c.waitingCustomer && !c.callerSpoke && now>=c.noCustomerSpeechOrigin+noCustomerSpeechMs && initial.result === 'no_speech_timeout' && !recentVoice(now) &&
            !c.hold && !c.transferred && !c.handoffPending && !c.prepareRequested && !c.recognizing && !c.frames.length) {
          const detail = `digital_silence; pcm_ms=${initial.audioMs}; decision_delay_ms=${initial.decisionDelayMs}`;
          void endCustomerCall(false,'initial_no_speech_timeout',detail);
          return;
        }
      }
      if(!c.lastInputAt&&!c.reportedNoPcm&&Date.now()-c.started>=10000){
        c.reportedNoPcm=true;logger(`Audio lifecycle diagnostic: no inbound PCM for call ${c.callId} after 10 seconds`);
      }
      const initialDeadline=c.noCustomerSpeechOrigin+noCustomerSpeechMs;
      // Give speech already entering recognition time to clear the echo and confidence checks.
      const verifyingSpeech=now<initialDeadline+6500&&(recentVoice(now)||c.frames.length||c.recognizing||c.turnCarry);
      if(!c.answerDetector?.ownsSilence&&!testOnly&&!c.waitingCustomer&&!c.callerSpoke&&now>=initialDeadline&&!verifyingSpeech){
        const evidence=`origin=${c.noCustomerSpeechOriginSource}; elapsed_ms=${now-c.noCustomerSpeechOrigin}`;
        void endCustomerCall(false,'no_customer_speech_deadline',evidence);
        return;
      }
      if(c.scriptLimitMs&&!c.scriptDeadlineBypassed&&now>=c.noCustomerSpeechOrigin+c.scriptLimitMs){
        const engaged=c.businessOutcome || (c.lastMeaningfulTurnAt!==undefined&&now-c.lastMeaningfulTurnAt<20000);
        if(engaged) c.scriptDeadlineBypassed=true;
        else if(!c.recognizing&&!c.frames.length&&!c.turnCarry&&!recentVoice(now)){
          const evidence=`limit_s=${c.scriptLimitMs/1000}; origin=${c.noCustomerSpeechOriginSource}; at=${new Date(c.noCustomerSpeechOrigin).toISOString()}`;
          void endCustomerCall(false,'script_duration_limit',evidence);
          return;
        }
      }
      if(c.limit&&now-c.started>=c.limit*1000&&
         !c.handoffPending&&!c.nativeTransferPending&&!c.handoffAnnouncement&&!c.prepareRequested){
        void endCustomerCall(false,'call_duration_limit');
        return;
      }
      // Give the full recovery sequence time to run, while retaining a hard
      // escape for an opening stream that never releases its worker.
      if(!c.answerDetector?.ownsSilence&&testOnly&&!enforceInitialSilence&&!c.scriptLimitMs&&c.businessDeadline===undefined&&c.workerFailureAt===undefined&&c.openingResponse.tick(Date.now(),Boolean(c.hold||c.transferred||c.handoffPending||c.prepareRequested||c.frames.length||c.recognizing||c.turnCarry))){void endCustomerCall(true);return;}
      if(c.turnCarry&&!c.frames.length&&!c.recognizing&&Date.now()>=c.turnHoldUntil){
        c.frames=c.turnCarry.frames;c.speechOverlap=c.turnCarry.overlap;c.turnCarry=undefined;c.turnHoldUntil=undefined;
        finishUtterance();return;
      }
      const blocked=recentVoice(now)||c.turnCarry||c.hold||c.customerHolding||c.handoffAnnouncement||c.nativeTransferPending||
        c.handoffPending||c.prepareRequested||c.syncHandoffPending||c.processing||c.queue.length||c.writing||
        c.frames.length||c.recognizing;
      const step=c.silenceClock.tick(now,Boolean(blocked||!c.callerSpoke||!c.hasCompletedSpeech||
        !c.playbackReported&&c.renderedThisTurn||c.endAfterPlayback||c.watchdogPending));
      if(c.workerFailureAt!==undefined&&Date.now()>=c.workerFailureAt&&
         !c.hold&&!c.transferred&&!c.handoffPending&&!c.prepareRequested&&!c.syncHandoffPending){
        void endCustomerCall(true,'audio_bridge_failure','voice_worker_recovery_deadline');
        return;
      }
      if(!c.scriptLimitMs&&!c.businessOutcome&&!c.watchdogPending&&!c.nativeTransferPending&&!c.handoffAnnouncement&&
         !(c.transferDiscussion&&(c.processing||c.queue.length||c.writing))&&c.businessDeadline!==undefined&&
         Date.now()>=c.businessDeadline&&!c.frames.length&&!c.recognizing&&!c.turnCarry&&
         !c.hold&&!c.customerHolding&&!c.transferred&&!c.handoffPending&&!c.prepareRequested&&!c.syncHandoffPending&&
         (c.lastVoicedAt===undefined||Date.now()-c.lastVoicedAt>=endOfSpeechMs)){
        c.watchdogPending=true;
        const value={action:'hangup',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,
          endInitiation:{reason:'no_business_outcome_timeout',decidedAt:new Date().toISOString(),evidence:'no_valid_script_answer'}};
        persistEvent(value);void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`),true);
        return;
      }
      if(blocked||c.watchdogPending)return;
      if(c.workerRetryPending&&c.workerFailureAt!==undefined&&now>=c.workerFailureAt-27000){
        const rejected=c.rejectedAdmission;
        if(rejected?.epoch===c.epoch)void turn(rejected.payload,rejected.recognition,true);
        else void turn({silenceStep:1,retryFailedSpeech:true});
        return;
      }
      if(c.endAfterPlayback){void endCustomerCall(Boolean(c.noResponseEnding));return;}
      if(step==='timeout'&&!c.answerDetector?.ownsSilence){void endCustomerCall(false,'customer_silence_timeout');return;}
      if(step==='recover')void turn({silenceStep:1});
      if(step==='continue')void turn({silenceStep:2});
    },100);silence.unref();
    socket.on('error',()=>socket.destroy());
    socket.on('close',()=>{clearTimeout(admissionTimeout);admissionAbort.abort();if(c?.detachTimer)clearTimeout(c.detachTimer);if(c?.syncRetryTimer)clearTimeout(c.syncRetryTimer);audioSockets.delete(socket);if(claimedUuid&&!initializing)audioIds.delete(claimedUuid);closing=true;clearInterval(timer);clearInterval(silence);clearInterval(stateWatch);if(c){if(c.answerDetector)c.answerDetector.close();else if(!c.mediaReady)callAnswer?.recordUnavailable(c.callId,c.noCustomerSpeechOrigin,'call_closed_before_media_ready');c.recognitionAbort?.abort();c.priorityProbe?.pending?.abort();flushNoise();logger(`Audio end call ${c.callId}: ${JSON.stringify({durationMs:Date.now()-c.started,inputPcmBytes:c.inputPcmBytes||0,inputVoicedMs:c.inputVoicedMs||0,outputPcmBytes:c.outputPcmBytes||0,inputGapFlushes:c.inputGapFlushes||0,bufferedSpeechBytes:c.frames.reduce((n,b)=>n+b.audio.length,0)})}`);recentSpeech.push({prefix:c.uuid.slice(0,4),voiceFlowRevision:c.voiceFlowRevision||'missing',inputVoicedMs:c.inputVoicedMs||0,speechProbeFailures:c.speechProbeFailures||0,speechFallbacks:0,lastSpeechIssue:c.lastSpeechIssue||null});if(recentSpeech.length>5)recentSpeech.shift();c.closed=true;c.initialAudio?.close();c.controller?.abort();c.queue.length=0;c.outputCarry=Buffer.alloc(0);calls.delete(c.uuid);
      const finishCallRecording=()=>{
        finishRecording(c);
        try{fs.unlinkSync(path.join(spoolDir,c.uuid+'.call.json'));}catch{/* Recovery file may already be gone. */}
      };
      const ended={durationSeconds:Math.floor((Date.now()-c.started)/1000)};
      if(c.mediaReady&&!remoteHangup&&!c.ending&&!c.transferred&&!c.handoffPending&&!c.prepareRequested&&!c.handoffAnnouncement)
        ended.endInitiation={reason:'audio_bridge_failure',decidedAt:new Date().toISOString(),evidence:'audio_socket_closed'};
      if(c.handoffPending&&c.transferred){
        event(c,'ended',ended);
        setImmediate(finishCallRecording);
      }else{
        finishCallRecording();
        event(c,'ended',ended);
      }
    }});
  });
  let maintaining=false;
  // Reconciliation may wait on native APIs or voice setup. Keep leases fresh independently.
  const heartbeat=setInterval(()=>{
    if(testOnly)return;
    void callback({action:'heartbeat',eventId:crypto.randomUUID(),externalCallId:'bridge-maintenance',
      activeCallIds:[...calls.values()].filter(call=>call.mediaReady).map(call=>call.callId)},AbortSignal.timeout(5000))
      .then(response=>response.arrayBuffer()).catch(()=>logger('Bridge heartbeat deferred'));
  },15000);
  heartbeat.unref();
  let maintenanceRetryAt=0;
  const maintenance=setInterval(()=>{
    if(maintaining||maintenanceRetryAt>Date.now())return;
    maintaining=true;
    void callback({action:'maintenance',eventId:crypto.randomUUID(),externalCallId:'bridge-maintenance',activeCallIds:[...calls.values()].map(c=>c.callId)})
      .then(async response=>{
        if(response.status===429||response.status>=500)maintenanceRetryAt=Date.now()+30000;
        await response.arrayBuffer();
      })
      .catch(()=>{maintenanceRetryAt=Date.now()+30000;logger('Queue maintenance deferred');})
      .finally(()=>{maintaining=false;});
  },15000);maintenance.unref();
  const retry=setInterval(()=>{for(const [id,r]of registered)if(r.expires<Date.now())registered.delete(id);void flushEvents();},1000);retry.unref();
  return {control,audio,close(){callAnswer?.close();shuttingDown=true;for(const timer of confirmationTimers)clearTimeout(timer);confirmationTimers.clear();clearInterval(retry);clearInterval(maintenance);clearInterval(heartbeat);for(const socket of audioSockets)socket.destroy();control.close();audio.close();},flushEvents};
}
if(require.main===module){
  const bridge=createBridge({callAnswerOptions:{},speech:JSON.parse(process.env.SHAHVEX_VICIDIAL_SPEECH||'{}'),siteUrl:process.env.SHAHVEX_SITE_URL,connectionId:process.env.SHAHVEX_VICIDIAL_CONNECTION_ID,secret:process.env.SHAHVEX_VICIDIAL_BRIDGE_SECRET,spoolDir:process.env.SHAHVEX_VICIDIAL_SPOOL||'/var/lib/shahvex-vicidial/events',maxCalls:Number(process.env.SHAHVEX_VICIDIAL_MAX_CALLS||10)});
  bridge.control.listen(Number(process.env.SHAHVEX_VICIDIAL_CONTROL_PORT||8790),'127.0.0.1');
  bridge.audio.listen(Number(process.env.SHAHVEX_VICIDIAL_AUDIO_PORT||9019),process.env.SHAHVEX_VICIDIAL_AUDIO_HOST||'127.0.0.1');
}
module.exports={createBridge,signature,signed,packet,wav,upsample};

