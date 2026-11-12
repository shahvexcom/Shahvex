'use strict';
// Install beside Asterisk (or behind a private VPN). AudioSocket stays private.
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createAiRecording,recoverAiRecording}=require('./ai-recording.cjs');
const signature=(secret,time,method,url,body)=>crypto.createHmac('sha256',secret).update(`${time}\n${method}\n${url}\n`).update(body).digest('hex');
const signed=(secret,req,body)=>{
  const time=req.headers['x-shahvex-timestamp']||'',sig=req.headers['x-shahvex-signature']||'';
  if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>60000||!/^[a-f0-9]{64}$/.test(sig))return false;
  return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(secret,time,req.method,req.url,body),'hex'));
};
function packet(type,body=Buffer.alloc(0)){const header=Buffer.alloc(3);header[0]=type;header.writeUInt16BE(body.length,1);return Buffer.concat([header,body]);}
function wav(pcm){const out=Buffer.alloc(44+pcm.length);out.write('RIFF');out.writeUInt32LE(36+pcm.length,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);return out;}
function upsample(pcm){const out=Buffer.alloc(pcm.length*2);for(let i=0;i<pcm.length;i+=2){const a=pcm.readInt16LE(i),b=i+2<pcm.length?pcm.readInt16LE(i+2):a;out.writeInt16LE(a,i*2);out.writeInt16LE(Math.round((a+b)/2),i*2+2);}return out;}
function createBridge({siteUrl,connectionId,secret,spoolDir,fetchImpl=fetch,logger=console.error,maxCalls=10,testOnly=false,allowUnregisteredManualAudio=false}={}){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw Error('Configure a valid bridge concurrent-call capacity');
  const site=new URL(siteUrl);if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||!secret||secret.length<32)throw Error('Configure HTTPS site URL, connection UUID and a secret of at least 32 characters');
  fs.mkdirSync(spoolDir,{recursive:true});const prepared=new Map(),registered=new Map(),calls=new Map();
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[\w-]+\.prepare\.json$/.test(n))){try{const value=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));if(value.connectionId===connectionId)prepared.set(value.remoteUser,value);}catch{/* Invalid saved mapping is not used. */}}
  const recordingDir=path.join(spoolDir,'recordings');
  const audioSockets=new Set();
  const endpoint=new URL('/api/telephony/vicidial',site);
  async function callback(value,signal){const body=Buffer.from(JSON.stringify(value)),time=String(Date.now());return fetchImpl(endpoint,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(125000)]):AbortSignal.timeout(125000),headers:{'content-type':'application/json','x-shahvex-connection':connectionId,'x-shahvex-timestamp':time,'x-shahvex-signature':signature(secret,time,'POST',endpoint.pathname,body)},body});}
  function persistEvent(value){fs.writeFileSync(path.join(spoolDir,`${value.eventId}.event.json`),JSON.stringify(value),{mode:0o600});}
  for(const name of fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.call\.json$/.test(n))){
    try{const previous=JSON.parse(fs.readFileSync(path.join(spoolDir,name),'utf8'));const recording=recoverAiRecording(recordingDir,name.replace('.call.json',''));if(recording)persistEvent({action:'recording',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId,aiRecordingId:recording.id,recordingSize:recording.bytes});persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:previous.externalCallId,callId:previous.callId});fs.unlinkSync(path.join(spoolDir,name));}catch{logger('Active call recovery metadata could not be read');}
  }
  let flushing=false;
  async function flushEvents(){if(flushing)return;flushing=true;try{for(const name of fs.readdirSync(spoolDir).filter(n=>/^[a-f0-9-]+\.event\.json$/.test(n))){const file=path.join(spoolDir,name);try{const value=JSON.parse(fs.readFileSync(file,'utf8'));const response=await callback(value);if(response.ok){const result=await response.json();if(result.humanConnected||value.action==='customer-ended')releaseAiMedia(value.externalCallId);if(!result.syncPending)fs.unlinkSync(file);}}catch{logger('VICIdial event pending retry');}}}finally{flushing=false;}}
  function event(c,action,extra={}){const value={action,eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,...extra};persistEvent(value);void flushEvents();}
  function finishRecording(c){
    const recording=c.recorder?.finish();if(recording)event(c,'recording',{aiRecordingId:recording.id,recordingSize:recording.bytes});
  }
  function releaseAiMedia(externalCallId){
    const active=[...calls.values()].find(c=>c.externalCallId===externalCallId);if(!active)return;
    finishRecording(active);active.transferred=true;active.queue.length=0;active.controller?.abort();
    active.socket?.end(packet(0)); // Detach only the AI AudioSocket leg; never hang up the human/customer call.
  }
  const control=http.createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32000)return reply(413,{error:'Too large'});chunks.push(chunk);}const raw=Buffer.concat(chunks);
      if(!signed(secret,req,raw))return reply(401,{error:'Unauthorized'});
      if(req.method==='GET'&&req.url==='/health')return reply(200,{protocol:'shahvex-vicidial-v1',audioSocket:audio.listening,sharedTester:true,aiOnlyRecording:true,humanAnswerEvents:true,maxCalls,activeCalls:calls.size,testOnly});
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
    if(audioSockets.size>=maxCalls){socket.end(packet(0));return;}audioSockets.add(socket);
    let pending=Buffer.alloc(0),c,closing=false,writing=false;
    const timer=setInterval(()=>{
      if(!c||socket.destroyed)return;
      const input=c.captureInput.subarray(0,320);c.captureInput=c.captureInput.subarray(Math.min(320,c.captureInput.length));
      const frame=!c.hold&&!c.handoffPending&&!writing&&c.queue.length?c.queue.shift():Buffer.alloc(0);
      try{c.recorder?.frame(input,frame);}catch{logger('AI recording failed');void endCustomerCall();return;}
      if(!frame.length)return;
      writing=true;c.writing=true;socket.write(packet(0x10,frame),()=>{writing=false;if(c){c.writing=false;c.lastSpeech=Date.now();}});
    },20);timer.unref();
    async function turn(payload){
      if(!c||c.hold||c.handoffPending||closing)return;
      const epoch=++c.epoch;c.controller?.abort();const abort=new AbortController();c.controller=abort;c.processing=true;
      try{
        const response=await callback({action:'turn',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId,...payload},abort.signal);
        if(!response.ok||!response.body)throw Error('Voice turn failed');
        let text='',carry=Buffer.alloc(0);const decoder=new TextDecoder();
        const consume=line=>{if(!line.trim())return;const e=JSON.parse(line);if(e.type==='error')throw Error('Shared voice engine error');
          if(e.type==='pcm'){
            if(e.sampleRate!==24000)throw Error('Unexpected voice sample rate');
            carry=Buffer.concat([carry,Buffer.from(e.data,'base64')]);
            // Average 3 samples from 24 kHz into 8 kHz; preserve partial samples.
            const count=Math.floor(carry.length/6),down=Buffer.alloc(count*2);
            for(let i=0;i<count;i++)down.writeInt16LE(Math.round((carry.readInt16LE(i*6)+carry.readInt16LE(i*6+2)+carry.readInt16LE(i*6+4))/3),i*2);
            carry=carry.subarray(count*6);c.outputCarry=Buffer.concat([c.outputCarry,down]);
            while(c.outputCarry.length>=320){c.queue.push(c.outputCarry.subarray(0,320));c.outputCarry=c.outputCarry.subarray(320);}
            if(c.queue.length>3000)throw Error('Voice playback queue exceeded limit');
          }
          if(e.type==='end_call')c.endAfterPlayback=true;
        };
        for await(const chunk of response.body){if(c.epoch!==epoch||closing)throw Error('Cancelled');text+=decoder.decode(chunk,{stream:true});let at;while((at=text.indexOf('\n'))>=0){consume(text.slice(0,at));text=text.slice(at+1);}}
        text+=decoder.decode();if(text.trim())consume(text);
        if(c.outputCarry.length){const tail=Buffer.alloc(320);c.outputCarry.copy(tail);c.queue.push(tail);c.outputCarry=Buffer.alloc(0);}
        if(payload.audio||payload.text){const result=await callback({action:'retry-sync',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});const data=await result.json();if(data.transferSubmitted){c.transferred=true;c.queue.length=0;fs.writeFileSync(path.join(spoolDir,`${c.externalCallId}.handoff.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId}),{mode:0o600});}if(data.syncPending)event(c,'retry-sync');}
      }catch(error){if(!abort.signal.aborted&&!closing){logger('VICIdial voice turn failed; requesting customer hangup');void endCustomerCall();}}
      finally{if(c?.epoch===epoch){c.processing=false;c.lastSpeech=Date.now();}}
    }
    async function initialize(uuid){
      let metadata=registered.get(uuid);registered.delete(uuid);
      if(!metadata&&testOnly&&allowUnregisteredManualAudio)metadata={uuid,externalCallId:'manual-'+uuid.replaceAll('-',''),agentUser:'manual-test',expires:Date.now()+30000};
      if(!metadata||metadata.expires<Date.now())throw Error('Unregistered AudioSocket call');
      const response=await callback({action:'connected',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,agentUser:metadata.agentUser,...(metadata.asteriskUniqueid?{asteriskUniqueid:metadata.asteriskUniqueid}:{}),...(metadata.asteriskLinkedid?{asteriskLinkedid:metadata.asteriskLinkedid}:{})});
      const data=await response.json();if(!response.ok){if(data.callId)persistEvent({action:'recover',eventId:crypto.randomUUID(),externalCallId:metadata.externalCallId,callId:data.callId});throw Error('Answered call was not accepted');}
      if(!data.callId||data.status==='FAILED'||data.status==='COMPLETED')throw Error('Call unavailable');
      c={...metadata,socket,callId:data.callId,queue:[],outputCarry:Buffer.alloc(0),frames:[],pre:[],voiceFrames:0,silent:0,started:Date.now(),lastSpeech:Date.now(),silenceStep:0,processing:false,hold:false,epoch:0,captureInput:Buffer.alloc(0),recorder:createAiRecording(recordingDir,uuid)};calls.set(uuid,c);
      if(closing){finishRecording(c);event(c,'ended',{durationSeconds:0});calls.delete(uuid);return;}
      fs.writeFileSync(path.join(spoolDir,`${uuid}.call.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId,agentUser:c.agentUser}),{mode:0o600});
      fs.writeFileSync(path.join(spoolDir,`${c.externalCallId}.handoff.json`),JSON.stringify({callId:c.callId,externalCallId:c.externalCallId}),{mode:0o600});
      c.limit=data.maxCallDurationSeconds||0;
      const ready=await callback({action:'media-ready',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});if(!ready.ok)throw Error('Media reservation was not activated');await ready.arrayBuffer();
      if(data.first==='ai')void turn({opening:true});
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
          if(!c.handoffPending&&!c.transferred)c.captureInput=Buffer.concat([c.captureInput,payload]).subarray(-16000);
          if(c.hold||c.transferred||c.handoffPending||c.prepareRequested||c.ending)return;
          let sum=0;for(let i=0;i<payload.length;i+=2)sum+=payload.readInt16LE(i)**2;
          const voiced=Math.sqrt(sum/Math.max(1,payload.length/2))>=(c.queue.length?800:350);
          const ms=payload.length/16;
          if(voiced){c.voiceFrames+=ms;c.silent=0;c.lastSpeech=Date.now();}else c.silent+=ms;
          c.pre.push(payload);while(c.pre.reduce((n,b)=>n+b.length,0)>3200)c.pre.shift();
          if(c.voiceFrames>=180&&!c.frames.length){c.frames=c.pre.slice();c.silenceStep=0;
            if(c.processing||c.queue.length){c.epoch++;c.controller?.abort();c.queue.length=0;c.outputCarry=Buffer.alloc(0);const interrupted=await callback({action:'interrupt',eventId:crypto.randomUUID(),externalCallId:c.externalCallId,callId:c.callId});if(!interrupted.ok)throw Error('Voice cancellation not acknowledged');c.processing=false;}}
          else if(c.frames.length)c.frames.push(payload);
          if(c.frames.length&&(c.silent>=400||c.frames.reduce((n,b)=>n+b.length,0)>=320000)){const speech=upsample(Buffer.concat(c.frames));c.frames=[];c.voiceFrames=0;c.silent=0;c.pre=[];void turn({audio:wav(speech).toString('base64')});}
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
    const silence=setInterval(()=>{
      if(!c||closing||c.hold||c.transferred||c.handoffPending||c.processing||c.queue.length||c.frames.length)return;
      if((c.limit&&Date.now()-c.started>=c.limit*1000)||c.endAfterPlayback){void endCustomerCall();return;}
      if(Date.now()-c.lastSpeech>=10000){c.lastSpeech=Date.now();void turn({silenceStep:++c.silenceStep});}
    },500);silence.unref();
    socket.on('error',()=>{});
    socket.on('close',()=>{audioSockets.delete(socket);closing=true;clearInterval(timer);clearInterval(silence);if(c){c.closed=true;c.controller?.abort();finishRecording(c);calls.delete(c.uuid);event(c,'ended',{durationSeconds:Math.floor((Date.now()-c.started)/1000)});try{fs.unlinkSync(path.join(spoolDir,`${c.uuid}.call.json`));}catch{/* Recovery file may already be gone. */}}});
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
