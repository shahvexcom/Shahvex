'use strict';
// Install beside Asterisk (or behind a private VPN). AudioSocket stays private.
const {ConversationSilence}=require('../../gateway/conversation-silence.cjs');
const {interruptionKind}=require('../../gateway/conversation-flow.cjs');
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createAiRecording,recoverAiRecording}=require('./ai-recording.cjs');
const {createTelephoneDownsampler}=require('./audio-quality.cjs');
const signature=(secret,time,method,url,body)=>crypto.createHmac('sha256',secret).update(`${time}\n${method}\n${url}\n`).update(body).digest('hex');
const signed=(secret,req,body)=>{
  const time=req.headers['x-shahvex-timestamp']||'',sig=req.headers['x-shahvex-signature']||'';
  if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>60000||!/^[a-f0-9]{64}$/.test(sig))return false;
  return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(secret,time,req.method,req.url,body),'hex'));
};
function packet(type,body=Buffer.alloc(0)){const header=Buffer.alloc(3);header[0]=type;header.writeUInt16BE(body.length,1);return Buffer.concat([header,body]);}
function wav(pcm){const out=Buffer.alloc(44+pcm.length);out.write('RIFF');out.writeUInt32LE(36+pcm.length,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);return out;}
function upsample(pcm){const out=Buffer.alloc(pcm.length*2);for(let i=0;i<pcm.length;i+=2){const a=pcm.readInt16LE(i),b=i+2<pcm.length?pcm.readInt16LE(i+2):a;out.writeInt16LE(a,i*2);out.writeInt16LE(Math.round((a+b)/2),i*2+2);}return out;}
function createBridge({siteUrl,connectionId,secret,spoolDir,fetchImpl=fetch,logger=console.error,maxCalls=10,testOnly=false,allowUnregisteredManualAudio=false,localMonitor,resolveRegistration,playbackBufferMs=120,onCapacityChange}={}){
  if(!Number.isInteger(playbackBufferMs)||playbackBufferMs<0||playbackBufferMs>500)throw Error('Configure playback buffering between 0 and 500 ms');
  const bufferFrames=Math.ceil(playbackBufferMs/20);
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw Error('Configure a valid bridge concurrent-call capacity');
  const site=new URL(siteUrl);if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||!secret||secret.length<32)throw Error('Configure HTTPS site URL, connection UUID and a secret of at least 32 characters');
  fs.mkdirSync(spoolDir,{recursive:true});const prepared=new Map(),registered=new Map(),calls=new Map(),startingCalls=new Set();
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[\w-]+\.prepare\.json$/.test(n))){try{const value=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));if(value.connectionId===connectionId)prepared.set(value.remoteUser,value);}catch{/* Invalid saved mapping is not used. */}}
  const recordingDir=path.join(spoolDir,'recordings');
  const audioSockets=new Set();
  const endpoint=new URL('/api/telephony/vicidial',site);
  async function callback(value,signal){const body=Buffer.from(JSON.stringify(value)),time=String(Date.now());return fetchImpl(endpoint,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(125000)]):AbortSignal.timeout(125000),headers:{'content-type':'application/json','x-shahvex-connection':connectionId,'x-shahvex-timestamp':time,'x-shahvex-signature':signature(secret,time,'POST',endpoint.pathname,body)},body});}
  function persistEvent(value){fs.writeFileSync(path.join(spoolDir,`${value.eventId}.event.json`),JSON.stringify(value),{mode:0o600});}
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.call\.json$/.test(n))){
    try{const previous=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));const recording=recoverAiRecording(recordingDir,name.replace('.call.json',''));if(recording)persistEvent({action:'recording',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId,aiRecordingId:recording.id,recordingSize:recording.bytes});persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId});fs.unlinkSync(path.join(spoolDir,name));}catch{logger('Active call recovery metadata could not be read');}
  }
  let flushing=false;const delivering=new Set(),deliveringCalls=new Set();const urgent=action=>['ended','recover','customer-ended','human-answered'].includes(action);
  async function deliverEvent(value,file){
    if(delivering.has(value.eventId)||(!urgent(value.action)&&deliveringCalls.has(value.externalCallId)))return;delivering.add(value.eventId);if(!urgent(value.action))deliveringCalls.add(value.externalCallId);
    try{const response=await callback(value);if(response.ok){const result=await response.json();
      const active=[...calls.values()].find(c=>c.externalCallId===value.externalCallId);
      if(active&&value.action==='retry-sync'){
        if(result.nativeLinkPending)active.linkChecks=(active.linkChecks||0)+1;
        active.syncWanted=Boolean(result.syncPending||(result.nativeLinkPending&&(active.linkChecks||0)<5));
        if(active.syncWanted)scheduleSync(active);
      }
      if(result.humanConnected||value.action==='customer-ended'||result.transferSubmitted)releaseAiMedia(value.externalCallId);
      if(!result.syncPending)fs.rmSync(file,{force:true});
    }}catch{logger('VICIdial event pending retry');}finally{delivering.delete(value.eventId);if(!urgent(value.action))deliveringCalls.delete(value.externalCallId);}
  }
  async function flushEvents(){if(flushing)return;flushing=true;try{
    const entries=fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.event\.json$/.test(n)).flatMap(name=>{try{const file=path.join(spoolDir,name);return [{file,value:JSON.parse(fs.readFileSync(file,'utf8'))}]}catch{return []}}).sort((a,b)=>Number(urgent(b.value.action))-Number(urgent(a.value.action)));
    // Slow result collection cannot occupy the only lifecycle-event worker.
    for(let i=0;i<entries.length;i+=3)await Promise.all(entries.slice(i,i+3).map(({file,value})=>deliverEvent(value,file)));
  }finally{flushing=false;}}
  function scheduleSync(c){
    if(c.closed||c.transferred||c.syncRetryTimer)return;
    c.syncRetryTimer=setTimeout(()=>{c.syncRetryTimer=undefined;if(c.syncWanted&&!c.closed&&!c.transferred)event(c,'retry-sync');},1000);c.syncRetryTimer.unref();
  }
  function event(c,action,extra={}){
    if(action==='retry-sync'){c.syncWanted=true;if(deliveringCalls.has(c.externalCallId)){scheduleSync(c);return;}}
    const value={action,eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,...extra};persistEvent(value);
    if(urgent(action)||action==='retry-sync'){void deliverEvent(value,path.join(spoolDir,`${value.eventId}.event.json`));if(action==='retry-sync')scheduleSync(c);}else void flushEvents();
  }
  function finishRecording(c){
    const recording=c.recorder?.finish();if(recording)event(c,'recording',{aiRecordingId:recording.id,recordingSize:recording.bytes});
  }
  function releaseAiMedia(externalCallId){
    const active=[...calls.values()].find(c=>c.externalCallId===externalCallId);if(!active)return;
    finishRecording(active);active.transferred=true;active.queue.length=0;active.controller?.abort();
    active.socket?.end(packet(0)); // Detach only the AI AudioSocket leg; never hang up the human/customer call.
    active.detachTimer=setTimeout(()=>active.socket?.destroy(),500);active.detachTimer.unref();
  }
  const control=http.createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32000)return reply(413,{error:'Too large'});chunks.push(chunk);}const raw=Buffer.concat(chunks);
      if(!signed(secret,req,raw))return reply(401,{error:'Unauthorized'});
      if(req.method==='GET'&&req.url==='/health')return reply(200,{protocol:'shahvex-vicidial-v1',audioSocket:audio.listening,sharedTester:true,aiOnlyRecording:true,humanAnswerEvents:true,maxCalls,activeCalls:calls.size,audioConnections:audioSockets.size,startingCalls:startingCalls.size,testOnly,streams:[...calls.values()].map(c=>({callId:c.callId,prefix:c.uuid.slice(0,4),inputPcmBytes:c.inputPcmBytes||0,outputPcmBytes:c.outputPcmBytes||0,inputVoicedMs:c.inputVoicedMs||0,underruns:c.underruns||0,backpressureTicks:c.backpressureTicks||0,lateTicks:c.lateTicks||0,interruptions:c.interruptions||0,admissionMs:c.admissionMs,firstOutputMs:c.firstOutputMs}))});
      if(req.method==='POST'&&req.url==='/capacity'){
        let limit;try{limit=JSON.parse(raw.toString()).limit;}catch{return reply(400,{error:'Invalid capacity'});}
        if(!Number.isInteger(limit)||limit<1||limit>300)return reply(400,{error:'Choose 1-300 concurrent calls'});
        if(Math.max(audioSockets.size,calls.size+startingCalls.size)>limit)return reply(409,{error:'Active calls exceed the requested limit'});
        if(onCapacityChange)await onCapacityChange(limit);
        maxCalls=limit;return reply(200,{maxCalls,activeCalls:calls.size,startingCalls:startingCalls.size});
      }
      if(testOnly&&localMonitor&&req.url==='/local-monitor'&&['GET','POST'].includes(req.method)){
        try{return reply(200,await localMonitor(req.method==='POST'?JSON.parse(raw.toString()):undefined));}
        catch(error){return reply(400,{error:error.message});}
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
        if(registered.size>=maxCalls*2)return reply(429,{error:'Capacity reached'});
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
        const response=await callback(eventValue);const result=await response.json();
        if(!response.ok){persistEvent(eventValue);return reply(503,{error:'Handoff confirmation pending retry'});}
        if(active)releaseAiMedia(value.externalCallId);
        return reply(200,{accepted:true,...result});
      }
      if(req.method==='POST'&&req.url==='/command'){
        const c=[...calls.values()].find(c=>c.callId===value.callId);if(!c)return reply(404,{error:'Call not found'});
        if(value.action==='close-audio'&&c.externalCallId.startsWith('direct-')){c.queue.length=0;c.controller?.abort();c.socket?.end(packet(0));return reply(200,{accepted:true});}
        if(value.action==='detach-ai'&&c.handoffPending){releaseAiMedia(c.externalCallId);return reply(200,{accepted:true});}
        if(value.action!=='hold'&&value.action!=='resume'&&value.action!=='handoff-prepare')return reply(400,{error:'Unsupported command'});
        if(value.action==='handoff-prepare'){
          c.prepareRequested=true;const deadline=Date.now()+9000;
          while((c.queue.length||c.writing)&&!c.closed&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          if(c.closed||c.queue.length||c.writing){c.prepareRequested=false;return reply(409,{error:'AI playback is not ready for handoff'});}
          finishRecording(c);c.handoffPending=true;return reply(200,{accepted:true});
        }
        c.hold=value.action==='hold';if(c.hold){c.queue.length=0;c.controller?.abort();event(c,'interrupt');}return reply(200,{accepted:true});
      }
      return reply(404,{error:'Unknown operation'});
    }catch{return reply(503,{error:'Bridge operation failed'});}
  });
  const audio=net.createServer(socket=>{
    const acceptedAt=Date.now();
    socket.setNoDelay(true);
    if(audioSockets.size>=maxCalls){socket.end(packet(0));return;}audioSockets.add(socket);
    let pending=Buffer.alloc(0),c,closing=false,writing=false,lastTick=Date.now();
    const timer=setInterval(()=>{
      const tick=Date.now(),late=tick-lastTick>35;lastTick=tick;
      if(!c||socket.destroyed)return;
      if(late)c.lateTicks=(c.lateTicks||0)+1;
      if(writing)c.backpressureTicks=(c.backpressureTicks||0)+1;
      const input=c.captureInput.subarray(0,320);c.captureInput=c.captureInput.subarray(Math.min(320,c.captureInput.length));
      if(!c.playbackReady&&c.queue.length&&(c.queue.length>=bufferFrames||c.synthesisDone))c.playbackReady=true;
      if(c.playbackReady&&!c.queue.length&&c.processing&&!c.synthesisDone){c.underruns=(c.underruns||0)+1;c.playbackReady=false;}
      const frame=!c.hold&&!c.handoffPending&&!writing&&c.playbackReady&&c.queue.length?c.queue.shift():Buffer.alloc(0);
      try{c.recorder?.frame(input,frame);}catch{logger('AI recording failed');void endCustomerCall();return;}
      if(!frame.length)return;
      if(c.firstOutputMs===undefined){c.firstOutputMs=Date.now()-acceptedAt;logger(`Audio startup prefix ${c.uuid.slice(0,4)}: admission ${c.admissionMs}ms, first PCM ${c.firstOutputMs}ms`);}
      c.outputPcmBytes=(c.outputPcmBytes||0)+frame.length;writing=true;c.writing=true;socket.write(packet(0x10,frame),()=>{writing=false;if(c){c.writing=false;c.lastSpeech=Date.now();}});
    },20);timer.unref();
    async function turn(payload){
      if(!c||c.hold||c.handoffPending||c.prepareRequested||closing)return;
      const epoch=++c.epoch;c.controller?.abort();const abort=new AbortController();c.controller=abort;c.processing=true;c.playbackReady=false;c.synthesisDone=false;
      try{
        const response=await callback({action:'turn',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,...payload},abort.signal);
        if(response.status===409){
          const state=await response.json().catch(()=>({}));
          if(state.handoffPending||state.retryable||state.error==='Call is no longer handled by AI'||state.error==='Another voice turn is still finishing'){
            logger('Voice turn deferred during handoff or an existing turn; customer call preserved');return;
          }
        }
        if(!response.ok||!response.body)throw Error('Voice turn failed');
        let text='';const downsampler=createTelephoneDownsampler(),decoder=new TextDecoder();
        const consume=line=>{if(!line.trim())return;const e=JSON.parse(line);if(e.type==='error')throw Error('Shared voice engine error');
          if(e.type==='pcm'){
            if(e.sampleRate!==24000)throw Error('Unexpected voice sample rate');
            const down=downsampler.push(Buffer.from(e.data,'base64'));c.outputCarry=Buffer.concat([c.outputCarry,down]);
            while(c.outputCarry.length>=320){c.queue.push(c.outputCarry.subarray(0,320));c.outputCarry=c.outputCarry.subarray(320);}
            if(c.queue.length>3000)throw Error('Voice playback queue exceeded limit');
          }
          if(e.type==='done')c.synthesisDone=true;
          if(e.type==='end_call'){c.endAfterPlayback=true;c.noResponseEnding=e.reason==='no_response';}
        };
        for await(const chunk of response.body){if(c.epoch!==epoch||closing)throw Error('Cancelled');text+=decoder.decode(chunk,{stream:true});let at;while((at=text.indexOf('\n'))>=0){consume(text.slice(0,at));text=text.slice(at+1);}}
        text+=decoder.decode();if(text.trim())consume(text);
        c.synthesisDone=true;
        if(c.outputCarry.length){const tail=Buffer.alloc(320);c.outputCarry.copy(tail);c.queue.push(tail);c.outputCarry=Buffer.alloc(0);}
        if(!c.endAfterPlayback&&(payload.audio||payload.text))event(c,'retry-sync');
      }catch(error){if(!abort.signal.aborted&&!closing){logger('VICIdial voice turn failed; requesting customer hangup');void endCustomerCall();}}
      finally{if(c?.epoch===epoch){c.synthesisDone=true;c.processing=false;c.lastSpeech=Date.now();}}
    }
    async function initialize(uuid){
      let metadata=registered.get(uuid);registered.delete(uuid);
      if(!metadata&&testOnly&&allowUnregisteredManualAudio)metadata={uuid,externalCallId:'manual-'+uuid.replaceAll('-',''),agentUser:'manual-test',expires:Date.now()+30000};
      if(!metadata&&!testOnly&&resolveRegistration){
        const resolved=await resolveRegistration(uuid);
        if(resolved?.uuid===uuid&&resolved.audioUuid===uuid&&/^[\w-]{2,20}$/.test(resolved.agentUser||'')&&/^[\w-]{16,40}$/.test(resolved.externalCallId||'')&&!String(resolved.externalCallId).startsWith('manual-'))metadata={...resolved,expires:Date.now()+30000};
      }
      if(!metadata||metadata.expires<Date.now())throw Error('Unregistered AudioSocket call');
      if(startingCalls.has(metadata.externalCallId)||[...calls.values()].some(call=>call.externalCallId===metadata.externalCallId))throw Error('Call already has an audio leg');
      startingCalls.add(metadata.externalCallId);
      try {
      const response=await callback({action:'connected',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,agentUser:metadata.agentUser,...(metadata.audioUuid?{audioUuid:metadata.audioUuid}:{}),...(metadata.asteriskUniqueid?{asteriskUniqueid:metadata.asteriskUniqueid}:{}),...(metadata.asteriskLinkedid?{asteriskLinkedid:metadata.asteriskLinkedid}:{})});
      const data=await response.json();if(!response.ok){if(data.callId)persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,callId:data.callId});throw Error('Answered call was not accepted');}
      if(!data.callId||data.status==='FAILED'||data.status==='COMPLETED')throw Error('Call unavailable');
      c={...metadata,socket,callId:data.callId,admissionMs:Date.now()-acceptedAt,queue:[],outputCarry:Buffer.alloc(0),frames:[],pre:[],voiceFrames:0,silent:0,started:Date.now(),lastSpeech:Date.now(),silenceStep:0,silenceClock:new ConversationSilence(),processing:false,hold:false,epoch:0,captureInput:Buffer.alloc(0),recorder:createAiRecording(recordingDir,uuid)};calls.set(uuid,c);
      if(closing){finishRecording(c);event(c,'ended',{durationSeconds:0});calls.delete(uuid);return;}
      fs.writeFileSync(path.join(spoolDir,`${uuid}.call.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId,agentUser:c.agentUser}),{mode:0o600});
      fs.writeFileSync(path.join(spoolDir,`${c.externalCallId}.handoff.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId}),{mode:0o600});
      c.limit=data.maxCallDurationSeconds||0;
      const ready=await callback({action:'media-ready',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});if(!ready.ok)throw Error('Media reservation was not activated');await ready.arrayBuffer();
      if(!testOnly)event(c,'retry-sync'); // Link customer metadata in parallel with the opening audio.
      if(data.first==='ai')void turn({opening:true});
      } finally { startingCalls.delete(metadata.externalCallId); }
    }
    let input=Promise.resolve();
    socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);if(pending.length>128000){socket.destroy();return;}
      while(pending.length>=3){const size=pending.readUInt16BE(1);if(pending.length<3+size)break;const type=pending[0],payload=Buffer.from(pending.subarray(3,3+size));pending=pending.subarray(3+size);
        input=input.then(async()=>{
          if(type===0){socket.end();return;}
          if(type===1){if(c||payload.length!==16)throw Error('Invalid AudioSocket identifier');const hex=payload.toString('hex');await initialize(`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`);return;}
          if(type===3)return; // DTMF is not invented customer speech.
          if(type!==0x10||!c||payload.length%2)throw Error('Expected PCM16 8 kHz mono');
          c.inputPcmBytes=(c.inputPcmBytes||0)+payload.length;
          if(!c.handoffPending&&!c.transferred)c.captureInput=Buffer.concat([c.captureInput,payload]).subarray(-16000);
          if(c.hold||c.transferred||c.handoffPending||c.prepareRequested||c.ending)return;
          let sum=0;for(let i=0;i<payload.length;i+=2)sum+=payload.readInt16LE(i)**2;
          const voiced=Math.sqrt(sum/Math.max(1,payload.length/2))>=(c.queue.length?800:350);
          const ms=payload.length/16;
          if(voiced){c.inputVoicedMs=(c.inputVoicedMs||0)+ms;c.voiceFrames+=ms;c.silent=0;c.lastSpeech=Date.now();}else c.silent+=ms;
          c.pre.push(payload);while(c.pre.reduce((n,b)=>n+b.length,0)>9600)c.pre.shift();
          if(c.voiceFrames>=180&&!c.frames.length){c.frames=c.pre.slice();c.silenceStep=0;c.silenceClock.speech();if(c.noResponseEnding){c.endAfterPlayback=false;c.noResponseEnding=false;}c.speechOverlap=Boolean(c.processing||c.queue.length||c.writing);c.bargeProbeCount=0;c.bargeConfirmed=false;}
          else if(c.frames.length)c.frames.push(payload);
          if(c.frames.length&&voiced&&c.speechOverlap&&!c.bargeConfirmed&&!c.bargeProbeBusy&&(c.bargeProbeCount||0)<2&&c.voiceFrames>=[320,640][c.bargeProbeCount||0]&&(c.processing||c.queue.length||c.writing)){
            c.bargeProbeCount=(c.bargeProbeCount||0)+1;c.bargeProbeBusy=true;
            const epoch=c.epoch,audio=wav(upsample(Buffer.concat(c.frames))).toString('base64');
            c.bargeProbe=(async()=>{try{
              const response=await callback({action:'listen',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,audio},AbortSignal.timeout(5000));
              if(!response.ok||c.closed||c.ending||c.handoffPending||c.transferred||c.epoch!==epoch)return;
              const heard=await response.json();if(interruptionKind(heard.text)!=='interrupt'||!(c.processing||c.queue.length||c.writing))return;
              c.bargeConfirmed=true;c.interruptions=(c.interruptions||0)+1;c.playbackReady=false;c.epoch++;c.controller?.abort();c.queue.length=0;c.outputCarry=Buffer.alloc(0);c.processing=false;
              const cancelled=await callback({action:'interrupt',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});
              if(!cancelled.ok)logger('Early speech cancellation pending; full recording retained');
            }catch{logger('Early speech classification unavailable; full recording retained');}finally{c.bargeProbeBusy=false;}})();
          }
          if(c.frames.length&&(c.silent>=700||c.frames.reduce((n,b)=>n+b.length,0)>=320000)){
            const audio=wav(upsample(Buffer.concat(c.frames))).toString('base64'),overlap=c.speechOverlap,earlyProbe=c.bargeProbe;
            c.frames=[];c.voiceFrames=0;c.silent=0;c.pre=[];
            c.recognizing=(c.recognizing||0)+1;
            c.speechDecisions=(c.speechDecisions||Promise.resolve()).then(async()=>{
              await earlyProbe;const epoch=c.epoch;
              if(c.closed||c.ending||c.transferred||c.handoffPending||c.epoch!==epoch)return;
              if(!overlap){void turn({audio});return;}
              const probe=await callback({action:'listen',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,audio},AbortSignal.timeout(8000));
              if(!probe.ok){logger('Speech classification unavailable; preserving current playback');return;}
              const heard=await probe.json();heard.kind=interruptionKind(heard.text);
              if(c.closed||c.epoch!==epoch||!heard.text||['ignore','filler'].includes(heard.kind))return;
              const speaking=c.processing||c.queue.length||c.writing;
              if(heard.kind==='acknowledgment'&&speaking)return;
              if(speaking){
                c.interruptions=(c.interruptions||0)+1;c.playbackReady=false;c.epoch++;c.controller?.abort();c.queue.length=0;c.outputCarry=Buffer.alloc(0);
                const interrupted=await callback({action:'interrupt',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});
                if(!interrupted.ok){logger('Voice cancellation pending; preserving customer call');return;}c.processing=false;
              }
              void turn({text:heard.text});
            }).catch(()=>logger('Speech decision unavailable; preserving current playback')).finally(()=>{c.recognizing=Math.max(0,(c.recognizing||1)-1);});
          }
          else if(!voiced&&!c.frames.length&&c.silent>200)c.voiceFrames=0;
        }).catch(()=>{if(c)void endCustomerCall();else socket.destroy();});
      }
    });
    async function endCustomerCall(){
      if(!c||c.ending||closing)return;c.ending=true;
      const value={action:'hangup',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId};
      try{const response=await callback(value);if(!response.ok)throw Error('Hangup not confirmed');socket.end(packet(0));}
      catch{persistEvent(value);logger('Customer hangup not confirmed; queued for reconciliation');c.ending=false;}
    }
    let checkingState=false;
    const stateWatch=setInterval(async()=>{
      if(testOnly||!c||closing||c.closed||checkingState)return;checkingState=true;
      try{const response=await callback({action:'call-state',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});if(response.ok){const state=await response.json();if(state.customerEnded||state.transferSubmitted)releaseAiMedia(c.externalCallId);}}
      catch{/* A network failure never proves a customer has ended. */}finally{checkingState=false;}
    },1500);stateWatch.unref();
    const silence=setInterval(()=>{
      if(!c||closing)return;
      const blocked=c.hold||c.transferred||c.handoffPending||c.prepareRequested||c.syncWanted||c.processing||c.queue.length||c.frames.length||c.writing||c.recognizing;
      const step=c.silenceClock.tick(Date.now(),Boolean(blocked));
      if(blocked)return;
      if((c.limit&&Date.now()-c.started>=c.limit*1000)||(c.endAfterPlayback&&!c.noResponseEnding)||(step===4&&c.endAfterPlayback&&c.noResponseEnding)){void endCustomerCall();return;}
      if(step===4){c.silenceClock.reset();return;}
      if(step){c.silenceStep=step;void turn({silenceStep:step});}
    },100);silence.unref();
    socket.on('error',()=>{});
    socket.on('close',()=>{if(c?.detachTimer)clearTimeout(c.detachTimer);if(c?.syncRetryTimer)clearTimeout(c.syncRetryTimer);audioSockets.delete(socket);closing=true;clearInterval(timer);clearInterval(silence);clearInterval(stateWatch);if(c){c.closed=true;c.controller?.abort();finishRecording(c);calls.delete(c.uuid);event(c,'ended',{durationSeconds:Math.floor((Date.now()-c.started)/1000)});try{fs.unlinkSync(path.join(spoolDir,`${c.uuid}.call.json`));}catch{/* Recovery file may already be gone. */}}});
  });
  const maintenance=setInterval(()=>{void callback({action:'maintenance',eventId:crypto.randomUUID(),externalCallId:'bridge-maintenance',activeCallIds:[...calls.values()].map(c=>c.callId)}).then(response=>response.arrayBuffer()).catch(()=>logger('Queue maintenance pending'));},15000);maintenance.unref();
  const retry=setInterval(()=>{for(const [id,r]of registered)if(r.expires<Date.now())registered.delete(id);void flushEvents();},10000);retry.unref();
  return {control,audio,close(){clearInterval(retry);clearInterval(maintenance);for(const socket of audioSockets)socket.destroy();control.close();audio.close();},flushEvents};
}
if(require.main===module){
  const bridge=createBridge({siteUrl:process.env.SHAHVEX_SITE_URL,connectionId:process.env.SHAHVEX_VICIDIAL_CONNECTION_ID,secret:process.env.SHAHVEX_VICIDIAL_BRIDGE_SECRET,spoolDir:process.env.SHAHVEX_VICIDIAL_SPOOL||'/var/lib/shahvex-vicidial/events',maxCalls:Number(process.env.SHAHVEX_VICIDIAL_MAX_CALLS||10)});
  bridge.control.listen(Number(process.env.SHAHVEX_VICIDIAL_CONTROL_PORT||8790),'127.0.0.1');
  bridge.audio.listen(Number(process.env.SHAHVEX_VICIDIAL_AUDIO_PORT||9019),process.env.SHAHVEX_VICIDIAL_AUDIO_HOST||'127.0.0.1');
}
module.exports={createBridge,signature,signed,packet,wav,upsample};
