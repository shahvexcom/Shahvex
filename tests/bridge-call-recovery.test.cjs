const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw Error('Bridge event timed out');await wait(10);}}
function pcm(){return JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(96000,7).toString('base64')})+'\n{"type":"done"}\n';}
test('standalone bridge resolves a configured prefix and retries the same admission after transient failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-resolve-')),uuid='3548'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-',''),events=[];let socket,bytes=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'resolve-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},fetchImpl:async(_url,init)=>{
  const e=JSON.parse(init.body);events.push(e);
  if(e.action==='resolve-prefix'){
   if(events.filter(v=>v.action==='resolve-prefix').length===1)return Response.json({error:'The assigned audio-line agent is not ready',retryable:true},{status:409});
   return Response.json({uuid,audioUuid:uuid,agentUser:'78618',externalCallId:external});
  }
  if(e.action==='connected'){
   const attempt=events.filter(v=>v.action==='connected').length;
   if(attempt===1)return Response.json({error:'Temporary database failure'},{status:503});
   if(attempt===2)return Response.json({error:'Assignment is awaiting voice readiness',retryable:true},{status:409});
   return Response.json({callId:crypto.randomUUID(),mediaReady:true});
  }
  if(e.action==='turn')return new Response(pcm());
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await until(()=>bytes>0);
  assert.equal(events.filter(e=>e.action==='resolve-prefix').length,2);
  const admissions=events.filter(e=>e.action==='connected');assert.equal(admissions.length,3);assert.equal(new Set(admissions.map(e=>e.eventId)).size,1);assert(admissions.every(e=>e.audioUuid===uuid&&e.agentUser==='78618'));
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('short questions and substantive answers interrupt while greetings and backchannels preserve playback',async()=>{
 for(const signal of ['Hello','Who is this?', 'Can you transfer me?', 'Medicaid', 'Hmm','Yep']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-resume-'));let socket,bytes=0,interrupts=0,reply,probes=0;
  const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'resume-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
   const e=JSON.parse(init.body);
   if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
   if(e.action==='listen'){probes++;return Response.json({text:signal,...(signal==='Medicaid'?{confidence:0.2}:{})});}
   if(e.action==='interrupt'){interrupts++;return Response.json({interrupted:true});}
   if(e.action==='turn'){if(!e.opening)reply=e.text;return new Response(pcm().replace('{"type":"done"}',JSON.stringify({type:'done',turnId:e.eventId})));}
   return Response.json({saved:true});
  }});
  try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>bytes>0);
   const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);
   socket.write(Buffer.concat([...Array.from({length:20},()=>packet(0x10,voice)),...Array.from({length:30},()=>packet(0x10,Buffer.alloc(320)))]));
   await until(()=>probes>=2);
   const interrupting=['Who is this?','Can you transfer me?','Medicaid'].includes(signal);
   if(interrupting)await until(()=>reply===signal,900);
   else {
    await wait(60);assert.equal(reply,undefined,signal);
    if(signal==='Hello')await until(()=>reply===signal);
   }
   assert.equal(interrupts,interrupting?1:0,signal);
  }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('default prefix resolution cannot attach an unassigned or busy line',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-reject-'));let socket,admissions=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'reject-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},fetchImpl:async(_url,init)=>{const e=JSON.parse(init.body);if(e.action==='resolve-prefix')return Response.json({error:'The assigned audio-line agent is not ready'},{status:409});if(e.action==='connected')admissions++;return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));const closed=new Promise(r=>socket.once('close',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await closed;assert.equal(admissions,0);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('native metadata linking keeps retrying beyond five pending checks without blocking playback',async()=>{
 const originalSetTimeout=global.setTimeout;
 global.setTimeout=(fn,ms,...args)=>originalSetTimeout(fn,[1000,2000,4000,8000,10000].includes(ms)?10:ms,...args);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-native-link-')),uuid='3548'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');let socket,links=0,bytes=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'native-link-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78618',externalCallId:external}),fetchImpl:async(_url,init)=>{
  const e=JSON.parse(init.body);
  if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
  if(e.action==='retry-sync'){links++;return Response.json(links<7?{saved:true,nativeLinkPending:true}:{saved:true});}
  if(e.action==='turn')return new Response(pcm());
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await until(()=>links>=7&&bytes>0);assert.equal(links,7);
 }finally{socket?.destroy();b.close();await wait(60);global.setTimeout=originalSetTimeout;fs.rmSync(dir,{recursive:true,force:true});}
});
test('native prefix resolution cannot bind an audio UUID returned for a different line',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-mismatch-'));let socket,admissions=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'mismatch-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},fetchImpl:async(_url,init)=>{const e=JSON.parse(init.body);if(e.action==='resolve-prefix'){const uuid=crypto.randomUUID();return Response.json({uuid,audioUuid:uuid,agentUser:'78618',externalCallId:'direct-'+uuid.replaceAll('-','')});}if(e.action==='connected')admissions++;return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));const closed=new Promise(r=>socket.once('close',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await closed;assert.equal(admissions,0);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('a stalled intro permits the recovery window and still has a bounded silent-call deadline',async()=>{
 const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-opening-window-'));let socket,bytes=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'deadline-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
  const e=JSON.parse(init.body);
  if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
  if(e.action==='turn'&&e.opening)return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(9600,3).toString('base64')})+'\n'));init.signal.addEventListener('abort',()=>{try{controller.close();}catch{}},{once:true});}}));
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>bytes>0);await wait(300);
  offset+=8500;await wait(120);assert.equal(socket.destroyed,false);
  const closed=new Promise(r=>socket.once('close',r));offset+=23000;await Promise.race([closed,wait(1000).then(()=>{throw Error('Stalled opening did not close');})]);
 }finally{socket?.destroy();b.close();await wait(60);Date.now=realNow;fs.rmSync(dir,{recursive:true,force:true});}
});
test('an immediate customer end discards queued audio and closes locally while native hangup is durably pending',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-customer-end-'));let socket,turns=0,output=0,hangups=0,release;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'customer-end-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
  const e=JSON.parse(init.body);
  if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
  if(e.action==='listen')return Response.json({text:'Hangup'});
  if(e.action==='turn'){turns++;return e.opening?new Response(pcm()):new Response('{"type":"end_call","reason":"customer_request","immediate":true}\n'+pcm());}
  if(e.action==='hangup'){hangups++;return new Promise(resolve=>{release=()=>resolve(Response.json({ended:true}));});}
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>output+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>output>0);
  const closed=new Promise(r=>socket.once('close',r)),voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);
  socket.write(Buffer.concat([...Array.from({length:20},()=>packet(0x10,voice)),...Array.from({length:30},()=>packet(0x10,Buffer.alloc(320)))]));
  await Promise.race([closed,wait(2000).then(()=>{throw Error('Customer end waited for backend or queued audio');})]);assert.equal(turns,2);assert.equal(hangups,1);
  assert(fs.readdirSync(dir).some(name=>name.endsWith('.event.json')&&JSON.parse(fs.readFileSync(path.join(dir,name))).action==='hangup'));
 }finally{release?.();socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('native playback completion is reported after the PCM queue drains, once for the matching turn',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-playback-'));let socket,bytes=0;const events=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'playback-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);events.push(e);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
 if(e.action==='turn')return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(9600,7).toString('base64')})+'\n'+JSON.stringify({type:'done',turnId:e.eventId})+'\n');
 return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>events.some(e=>e.action==='playback-complete'));assert(bytes>=3200);assert.equal(events.find(e=>e.action==='playback-complete').completedTurnId,events.find(e=>e.action==='turn').eventId);await wait(100);assert.equal(events.filter(e=>e.action==='playback-complete').length,1);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('a legacy incomplete completion label cannot impose an extra 1500ms hold on a finished speech window',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-semantic-'));let socket;const probes=[],replies=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'full-utterance-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
 if(e.action==='listen'){assert.equal(e.turnFinal,undefined);probes.push(Buffer.from(e.audio,'base64'));return Response.json({text:probes.length===1?'I have':'I have Medicaid.',completion:probes.length===1?'incomplete':'complete'});}
 if(e.action==='turn'){if(!e.opening)replies.push(e.text);return new Response('{"type":"done","turnId":"fixture-full-utterance"}\n');}
 return Response.json({saved:true});
 }});
 try{
 await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(100);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);
 const phrase=Buffer.concat(Array.from({length:15},()=>packet(0x10,voice)));socket.write(phrase);await until(()=>replies.length===1);assert.equal(replies[0],'I have');socket.write(phrase);
 await until(()=>replies.length===2,3000);assert.equal(replies[1],'I have Medicaid.');assert.equal(probes[1].length,probes[0].length,'independent speech windows are not held and retranscribed together');
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed or empty final speech probes cannot bypass transcript filtering',async()=>{
 for(const mode of ['http','empty']){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-probe-fallback-'));let socket;const committed=[],logs=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'probe-fallback-fixture-'.repeat(4),speech:{debug:true},spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:text=>logs.push(text),fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
 if(e.action==='listen')return mode==='http'?Response.json({error:'Probe unavailable'},{status:503}):Response.json({text:'',kind:'ignore'});
 if(e.action==='turn'){if(e.audio)committed.push(Buffer.from(e.audio,'base64'));return new Response((e.audio?'{"type":"user","text":"Hello"}\n':'')+'{"type":"done"}\n');}
 return Response.json({saved:true});
 }});
 try{
 await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(100);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);socket.write(Buffer.concat(Array.from({length:8},()=>packet(0x10,voice))));await until(()=>logs.some(text=>text.includes(mode==='http'?'http_503':'empty_transcript')));assert.equal(committed.length,0);assert.equal(socket.destroyed,false);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('short script deadlines preserve calls with a valid outcome and end unresolved idle calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-business-watchdog-'));
 const sockets=[],events=[],realNow=Date.now;
 const started=realNow(), configs=new Map();
 const at=ms=>{offset=started+ms-realNow();};
 let offset=0;
 Date.now=()=>realNow()+offset;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'script-deadline-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},createSpeechScorer:()=>async()=>0.4,
  resolveRegistration:async uuid=>({uuid,audioUuid:uuid,agentUser:'78618',externalCallId:'direct-'+uuid.replaceAll('-','')}),
  fetchImpl:async(_url,init)=>{
   const e=JSON.parse(init.body);events.push(e);
   const config=configs.get(e.externalCallId);
   if(e.action==='connected')return Response.json({callId:config.id,first:'customer',mediaReady:true,maxCallDurationSeconds:config.limit});
   if(e.action==='listen'&&config.engaged)return Response.json({text:'Why do you need to know that?',confidence:0.95});
   if(e.action==='turn'&&config.limit)return new Response(new ReadableStream());
   if(e.action==='call-state')return Response.json({connectedAt:new Date(started).toISOString(),businessQuestionCount:config.count,businessOutcome:config.outcome});
   if(e.action==='hangup')return Response.json({ended:true});
   return Response.json({saved:true});
  },
 });
 async function connect(count,outcome=false,spoken=true,limit=0,engaged=false){
  const uuid=crypto.randomUUID(),external='direct-'+uuid.replaceAll('-',''),id=crypto.randomUUID();
  configs.set(external,{id,count,outcome,limit,engaged});
  const socket=net.connect(b.audio.address().port,'127.0.0.1');sockets.push(socket);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));
  if(spoken){
   const input=Buffer.alloc(320);
   for(let i=0;i<320;i+=2)input.writeInt16LE(3000*Math.sin(i/10),i);
   socket.write(Buffer.concat(Array.from({length:8},()=>packet(0x10,input))));
  }
  return {id,socket};
 }
 try{
  await new Promise((resolve,reject)=>{b.audio.once('error',reject);b.audio.listen(0,'127.0.0.1',resolve);});
  const one=await connect(1),two=await connect(2),three=await connect(3,true),valid=await connect(2,true),empty=await connect(0),silent=await connect(3,false,false),busy=await connect(0,false,true,87),engaged=await connect(2,false,false,0,true);
  await until(()=>events.filter(e=>e.action==='call-state').length>=8);
  const calls=()=>events.filter(e=>e.action==='hangup');
  at(8400);
  const quietVoice=Buffer.alloc(320);
  for(let i=0;i<320;i+=2)quietVoice.writeInt16LE(Math.round(1900*Math.sin(i/10)),i);
  const utterance=Buffer.concat([...Array.from({length:26},()=>packet(0x10,quietVoice)),...Array.from({length:20},()=>packet(0x10,Buffer.alloc(320)))]);
  const engagedTurns=()=>events.filter(e=>e.action==='turn'&&e.callId===engaged.id&&e.text==='Why do you need to know that?');
  engaged.socket.write(utterance);
  await until(()=>engagedTurns().length===1);
  assert.equal(calls().length,0);
  at(10300);await until(()=>calls().length===1);
  assert.equal(calls()[0].callId,silent.id);
  assert.equal(calls()[0].endInitiation.reason,'no_customer_speech_deadline');
  at(87500);await until(()=>calls().length===2);
  assert.equal(calls()[1].callId,busy.id);
  assert.equal(calls()[1].endInitiation.reason,'call_duration_limit');
  at(88700);
  engaged.socket.write(utterance);
  await until(()=>engagedTurns().length===2);
  at(90000);await until(()=>calls().length===4);
  assert.deepEqual(new Set(calls().slice(2).map(e=>e.callId)),new Set([one.id,two.id]));
  await wait(160);
  at(120000);await wait(300);
  assert.equal(calls().length,4);
  assert(!valid.socket.destroyed);
  assert(!engaged.socket.destroyed);
  assert(!three.socket.destroyed);
  assert(calls().slice(2).every(e=>e.endInitiation.reason==='script_duration_limit'));
  assert(!empty.socket.destroyed);
  assert(!empty.socket.destroyed,'a different audio session remains connected');
 }finally{
  for(const socket of sockets)socket.destroy();
  b.close();Date.now=realNow;await wait(50);fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('opening recognition corroborates short answers without guessing after a failed probe', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-corroborated-speech-'));
 const turns=[],probes=[],logs=[];
 const replies=[
  {error:'Unavailable'},
  {text:'Yes.',confidence:0.02},
  {text:'No.',confidence:0.03},
  {text:'Yes.',confidence:0.02},
  {text:'I think so.',confidence:0.03},
  {text:'No.',confidence:0.02},
  {text:'No, but maybe.',confidence:0.03},
  {text:'Yes.',confidence:0.02},
  {text:'Yeah.',confidence:0.01},
 ];
 const bridge=createBridge({
  siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),
  secret:'corroborated-speech-fixture-'.repeat(3),spoolDir:dir,testOnly:true,
  allowUnregisteredManualAudio:true,createSpeechScorer:()=>async()=>0.9,
  enforceInitialSilence:true,speech:{debug:true},logger:line=>logs.push(line),
  fetchImpl:async(_url,init)=>{
   const event=JSON.parse(init.body);
   if(event.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true,first:'customer'});
   if(event.action==='listen'){
    probes.push(Buffer.from(event.audio,'base64'));
    const reply=replies.shift();
    return Response.json(reply,{status:reply?.error?503:200});
   }
   if(event.action==='turn'){turns.push(event.text);return new Response('{"type":"done"}\n');}
   return Response.json({saved:true});
  },
 });
 let socket;
 try{
  await new Promise(resolve=>bridge.audio.listen(0,'127.0.0.1',resolve));
  socket=net.connect(bridge.audio.address().port,'127.0.0.1');
  socket.on('data',()=>{});
  await new Promise(resolve=>socket.once('connect',resolve));
  socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));
  await wait(100);
  const frame=Buffer.alloc(320);
  for(let i=0;i<frame.length;i+=2)frame.writeInt16LE(i%4?2800:-2800,i);
  const utterance=Buffer.concat([
   ...Array.from({length:28},()=>packet(0x10,frame)),
   ...Array.from({length:18},()=>packet(0x10,Buffer.alloc(320))),
  ]);
  socket.write(utterance);
  await until(()=>logs.some(line=>line.includes('http_503')));
  assert.deepEqual(turns,[]);
  for(let count=1;count<=3;count++){
   socket.write(utterance);
   await until(()=>logs.filter(line=>line.includes('low_confidence')).length===count);
   assert.deepEqual(turns,[]);
  }
  socket.write(utterance);
  await until(()=>turns.length===1);
  assert.deepEqual(turns,['Yes.']);
  assert.equal(probes.length,9);
  assert.equal(probes[8].readUInt32LE(24),16000);
  assert.equal(probes[8].length,probes[7].length+16000);
  assert.deepEqual(probes[8].subarray(8044,-8000),probes[7].subarray(44));
 }finally{
  socket?.destroy();bridge.close();await wait(60);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
