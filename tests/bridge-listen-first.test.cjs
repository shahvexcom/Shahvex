const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('campaign opening sends PCM after a temporary turn-admission conflict', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-opening-retry-'));
 const uuid='3548'+crypto.randomUUID().slice(4);
 const externalCallId='direct-'+uuid.replaceAll('-','');
 const attempts=[];
 let socket;
 const bridge=createBridge({
  siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),
  secret:'opening-retry-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},
  resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78618',externalCallId}),
  fetchImpl:async(_url,init)=>{
   const event=JSON.parse(init.body);
   if(event.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});
   if(event.action!=='turn')return Response.json({saved:true});
   attempts.push(event);
   if(attempts.length===1)return Response.json({retryable:true},{status:409});
   return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(4800,3).toString('base64')})+'\n{"type":"done"}\n');
  }
 });
 try{
  await new Promise((resolve,reject)=>{
   bridge.audio.once('error',reject);
   bridge.audio.listen(0,'127.0.0.1',resolve);
  });
  socket=net.connect(bridge.audio.address().port,'127.0.0.1');
  const pcm=await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('Opening PCM did not arrive')),2500);
   socket.once('connect',()=>socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex'))));
   socket.once('error',error=>{clearTimeout(deadline);reject(error);});
   socket.once('data',data=>{clearTimeout(deadline);resolve(data);});
  });
  assert.equal(pcm[0],0x10);
  assert.equal(attempts.length,2);
  assert.ok(attempts.every(event=>event.opening&&event.externalCallId===externalCallId));
  assert.notEqual(attempts[0].eventId,attempts[1].eventId);
 }finally{
  socket?.destroy();
  bridge.close();
  await wait(60);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('remote speech and pending recognition hold opening audio; a detected machine closes silently',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'listen-first-')),uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');let socket,release,recognized=false,received=0;
 const blocked=new Promise(r=>release=()=>r(Response.json({text:'At the tone, please record your message.'})));
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'listen-first-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78601',externalCallId:external}),fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});if(v.action==='listen'){recognized=true;return blocked;}if(v.action==='turn'&&v.opening)return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(24000,3).toString('base64')})+'\n{"type":"done"}\n');return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>received+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await wait(120);
  const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?1800:-1800,i);for(let i=0;i<45;i++){socket.write(packet(0x10,voice));await wait(20);}socket.write(Buffer.concat(Array.from({length:19},()=>packet(0x10,Buffer.alloc(320)))));for(let i=0;i<60&&!recognized;i++)await wait(10);assert.equal(received,0);assert.equal(recognized,true);release();await wait(180);assert.ok(received<=3,'Only a hangup packet may be sent');
 }finally{release();socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
test('human greeting pauses the intro and is handled without hanging up',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'listen-human-')),uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');let socket,heard=false,hangups=0,output=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'listen-human-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78601',externalCallId:external}),fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});if(v.action==='listen')return Response.json({text:'Hello, who is calling?'});if(v.action==='hangup')hangups++;if(v.action==='turn'){if(!v.opening)heard=true;return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(4800,3).toString('base64')})+'\n{"type":"done"}\n');}return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',buf=>output+=buf.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await wait(120);const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?1800:-1800,i);for(let i=0;i<25;i++){socket.write(packet(0x10,voice));await wait(20);}assert.equal(output,0);socket.write(Buffer.concat(Array.from({length:20},()=>packet(0x10,Buffer.alloc(320)))));for(let i=0;i<200&&(!heard||!output);i++)await wait(10);assert.equal(heard,true);assert.ok(output>0);assert.equal(hangups,0);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
