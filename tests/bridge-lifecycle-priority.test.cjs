const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const waitFor=async condition=>{const until=Date.now()+1200;while(!condition()&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.ok(condition(),'event should not wait for held result synchronization');};
test('slow result sync cannot block another speech turn or the call-ended lifecycle event',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-priority-'));let releaseSync,held=false,resolved=false,ready=false,turns=0,ended=false,socket;
 const blocker=new Promise(r=>releaseSync=()=>{resolved=true;r(Response.json({saved:true}))});
 const uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');
 const b=createBridge({siteUrl:'https://isolated.example.test/',connectionId:crypto.randomUUID(),secret:'test-secret-'.repeat(5),spoolDir:folder,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78601',externalCallId:external}),fetchImpl:async(_url,init)=>{
  const value=JSON.parse(init.body);
  if(value.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer'});
  if(value.action==='media-ready')ready=true;
  if(value.action==='turn'){if(!value.opening)turns++;return new Response('{"type":"done"}\n');}
  if(value.action==='retry-sync'&&!held){held=true;return blocker;}
  if(value.action==='ended'){assert.equal(resolved,false);ended=true;}
  return Response.json({saved:true});
 }});
 try{
  await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await waitFor(()=>ready);
  const speak=()=>{const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?1500:-1500,i);socket.write(Buffer.concat([...Array.from({length:12},()=>packet(0x10,voice)),...Array.from({length:38},()=>packet(0x10,Buffer.alloc(320)))]));};
  speak();await waitFor(()=>held);speak();await waitFor(()=>turns===2);assert.equal(resolved,false);socket.destroy();await waitFor(()=>ended);
 }finally{releaseSync();socket?.destroy();await new Promise(r=>setTimeout(r,60));await b.flushEvents();b.close();await new Promise(r=>setTimeout(r,40));fs.rmSync(folder,{recursive:true,force:true});}
});

test('a completed customer turn during an in-flight sync triggers another sync',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-sync-race-'));let release,requests=0,ready=false,turns=0,socket;
 const blocked=new Promise(r=>release=()=>r(Response.json({saved:true,verificationPending:true})));
 const uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');
 const b=createBridge({siteUrl:'https://isolated.example.test/',connectionId:crypto.randomUUID(),secret:'test-secret-'.repeat(5),spoolDir:folder,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78601',externalCallId:external}),fetchImpl:async(_url,init)=>{
  const v=JSON.parse(init.body);if(v.action==='connected')return Response.json({callId:crypto.randomUUID()});if(v.action==='media-ready')ready=true;
  if(v.action==='retry-sync'){requests++;if(requests===1)return blocked;}
  if(v.action==='turn'){if(!v.opening)turns++;return new Response('{"type":"done"}\n');}return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await waitFor(()=>ready&&requests===1);
  const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?1500:-1500,i);socket.write(Buffer.concat([...Array.from({length:12},()=>packet(0x10,voice)),...Array.from({length:38},()=>packet(0x10,Buffer.alloc(320)))]));await waitFor(()=>turns===1);await new Promise(r=>setTimeout(r,40));release();await waitFor(()=>requests>=2);
 }finally{release();socket?.destroy();b.close();await new Promise(r=>setTimeout(r,60));fs.rmSync(folder,{recursive:true,force:true});}
});

test('native customer-end closes the bot promptly even when its AudioSocket peer stays open',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-native-end-'));let socket,ready=false,ended=false,checks=0;
 const uuid='3532'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');
 const b=createBridge({siteUrl:'https://isolated.example.test/',connectionId:crypto.randomUUID(),secret:'test-state-secret-'.repeat(4),spoolDir:folder,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78602',externalCallId:external}),fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);if(v.action==='listen')return Response.json({text:'Hello?',kind:'interrupt'});if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer'});if(v.action==='media-ready')ready=true;if(v.action==='call-state'){checks++;return Response.json({customerEnded:true})}if(v.action==='ended')ended=true;return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect({port:b.audio.address().port,host:'127.0.0.1',allowHalfOpen:true});socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await waitFor(()=>ready);const until=Date.now()+3500;while(!ended&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(ended,true);assert.ok(checks>=1);
 }finally{socket?.destroy();b.close();await new Promise(r=>setTimeout(r,60));await b.flushEvents();fs.rmSync(folder,{recursive:true,force:true});}
});

test('handoff and concurrent-turn conflicts never request customer hangup',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-handoff-race-'));let socket,ready=false,turns=0,hangups=0;
 const uuid='3532'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');
 const b=createBridge({siteUrl:'https://isolated.example.test/',connectionId:crypto.randomUUID(),secret:'test-race-secret-'.repeat(4),spoolDir:folder,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78602',externalCallId:external}),fetchImpl:async(_url,init)=>{
  const v=JSON.parse(init.body);if(v.action==='listen')return Response.json({text:'Hello?',kind:'interrupt'});if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer'});if(v.action==='media-ready')ready=true;
  if(v.action==='turn'){turns++;return Response.json(turns===1?{error:'Call is no longer handled by AI'}:turns===2?{error:'Transfer in progress',handoffPending:true}:{error:'Another voice turn is still finishing',retryable:true},{status:409});}
  if(v.action==='hangup')hangups++;
  return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await waitFor(()=>ready);
  for(let n=1;n<=3;n++){const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?1500:-1500,i);socket.write(Buffer.concat([...Array.from({length:12},()=>packet(0x10,voice)),...Array.from({length:38},()=>packet(0x10,Buffer.alloc(320)))]));await waitFor(()=>turns===n);await new Promise(r=>setTimeout(r,30));assert.equal(hangups,0);assert.equal(socket.destroyed,false);}
 }finally{socket?.destroy();b.close();await new Promise(r=>setTimeout(r,60));await b.flushEvents();fs.rmSync(folder,{recursive:true,force:true});}
});

test('concurrent sockets clean up by exact call ID and an old UUID cannot reconnect',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-exact-close-')),sockets=[],ids=new Map(),ended=[],checks=new Set();
 const b=createBridge({siteUrl:'https://isolated.example.test/',connectionId:crypto.randomUUID(),secret:'test-exact-secret-'.repeat(4),spoolDir:folder,logger:()=>{},resolveRegistration:async uuid=>({uuid,audioUuid:uuid,agentUser:'78616',externalCallId:'direct-'+uuid.replaceAll('-','')}),fetchImpl:async(_url,init)=>{
  const v=JSON.parse(init.body);
  if(v.action==='connected'){const callId=crypto.randomUUID();ids.set(v.audioUuid,callId);return Response.json({callId,first:'customer',mediaReady:true});}
  if(v.action==='call-state'){checks.add(v.callId);return Response.json({customerEnded:false});}
  if(v.action==='ended')ended.push(v.callId);
  return Response.json({saved:true});
 }});
 const open=async uuid=>{const socket=net.connect(b.audio.address().port,'127.0.0.1');sockets.push(socket);socket.on('error',()=>{});socket.on('data',()=>{});await new Promise(resolve=>socket.once('connect',resolve));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));return socket;};
 try{
  await new Promise(resolve=>b.audio.listen(0,'127.0.0.1',resolve));
  const uuids=Array.from({length:3},()=> '3546'+crypto.randomUUID().slice(4));
  const first=await open(uuids[0]),second=await open(uuids[1]);await waitFor(()=>ids.size===2);
  second.write(packet(0));await waitFor(()=>ended.length===1);assert.deepEqual(ended,[ids.get(uuids[1])]);assert.equal(first.destroyed,false);
  const replacement=await open(uuids[2]);await waitFor(()=>ids.size===3);
  const old=await open(uuids[1]);await waitFor(()=>old.destroyed);assert.equal(ids.size,3);
  first.destroy();await waitFor(()=>ended.length===2);assert.deepEqual(ended,[ids.get(uuids[1]),ids.get(uuids[0])]);
  await new Promise(resolve=>setTimeout(resolve,1600));assert(checks.has(ids.get(uuids[2])));assert.equal(replacement.destroyed,false);
 }finally{sockets.forEach(socket=>socket.destroy());b.close();await new Promise(resolve=>setTimeout(resolve,60));await b.flushEvents();fs.rmSync(folder,{recursive:true,force:true});}
});
