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
  if(e.action==='resolve-prefix')return Response.json({uuid,audioUuid:uuid,agentUser:'78618',externalCallId:external});
  if(e.action==='connected'){if(events.filter(v=>v.action==='connected').length===1)return Response.json({error:'Temporary database failure'},{status:503});return Response.json({callId:crypto.randomUUID(),mediaReady:true});}
  if(e.action==='turn')return new Response(pcm());
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await until(()=>bytes>0);
  const admissions=events.filter(e=>e.action==='connected');assert.equal(admissions.length,2);assert.equal(admissions[0].eventId,admissions[1].eventId);assert(admissions.every(e=>e.audioUuid===uuid&&e.agentUser==='78618'));
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('greeting and listening backchannels stop played audio and reach the shared turn handler',async()=>{
 for(const signal of ['Hello','Hmm','Yep']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-resume-'));let socket,bytes=0,interrupts=0,reply;
  const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'resume-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
   const e=JSON.parse(init.body);
   if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
   if(e.action==='listen')return Response.json({text:signal});
   if(e.action==='interrupt'){interrupts++;return Response.json({interrupted:true});}
   if(e.action==='turn'){if(!e.opening)reply=e.text;return new Response(pcm());}
   return Response.json({saved:true});
  }});
  try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>bytes>0);
   const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);
   socket.write(Buffer.concat([...Array.from({length:20},()=>packet(0x10,voice)),...Array.from({length:30},()=>packet(0x10,Buffer.alloc(320)))]));
   await until(()=>reply===signal);assert.equal(interrupts,1,signal);
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
  const closed=new Promise(r=>socket.once('close',r)),voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);
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
 if(e.action==='turn')return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(9600,7).toString('base64')})+'\n'+JSON.stringify({type:'done',turnId:'playback-test-turn'})+'\n');
 return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>bytes+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await until(()=>events.some(e=>e.action==='playback-complete'));assert(bytes>=3200);assert.equal(events.find(e=>e.action==='playback-complete').completedTurnId,'playback-test-turn');await wait(100);assert.equal(events.filter(e=>e.action==='playback-complete').length,1);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('semantic incomplete speech survives a 1500ms pause and commits only one combined customer turn',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-semantic-'));let socket;const probes=[],replies=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'full-utterance-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
 if(e.action==='listen'){assert.equal(e.turnFinal,true);probes.push(Buffer.from(e.audio,'base64'));return Response.json({text:probes.length===1?'I have':'I have Medicaid.',completion:probes.length===1?'incomplete':'complete'});}
 if(e.action==='turn'){if(!e.opening)replies.push(e.text);return new Response('{"type":"done","turnId":"fixture-full-utterance"}\n');}
 return Response.json({saved:true});
 }});
 try{
 await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(100);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);
 const phrase=Buffer.concat(Array.from({length:15},()=>packet(0x10,voice)));socket.write(phrase);await until(()=>probes.length===1);await wait(1500);assert.equal(replies.length,0,'unfinished thought must not commit or start a question');socket.write(phrase);
 await until(()=>replies.length===1,3000);assert.equal(replies[0],'I have Medicaid.');assert(probes[1].length>=44+30*640,'both original voiced sections reach STT together');
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed or empty final speech probes retry the original audio turn instead of dropping the caller',async()=>{
 for(const mode of ['http','empty']){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-probe-fallback-'));let socket;const committed=[],logs=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'probe-fallback-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:text=>logs.push(text),fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
 if(e.action==='listen')return mode==='http'?Response.json({error:'Probe unavailable'},{status:503}):Response.json({text:'',kind:'ignore'});
 if(e.action==='turn'){if(e.audio)committed.push(Buffer.from(e.audio,'base64'));return new Response((e.audio?'{"type":"user","text":"Hello"}\n':'')+'{"type":"done"}\n');}
 return Response.json({saved:true});
 }});
 try{
 await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(100);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);socket.write(Buffer.concat(Array.from({length:8},()=>packet(0x10,voice))));await until(()=>committed.length===1,3000);assert.equal(committed[0].readUInt32LE(24),16000);assert(committed[0].length>=44+8*640);assert.equal(socket.destroyed,false);assert(logs.some(text=>text.includes(mode==='http'?'http_503':'empty_transcript')));
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
 }
});
