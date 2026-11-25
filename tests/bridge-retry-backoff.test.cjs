const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const config=folder=>({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'outage-fixture-secret-'.repeat(3),spoolDir:folder,logger:()=>{}});
test('an interruption left on disk after a call ended is discarded without calling the website', async () => {
 const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shahvex-stale-interrupt-'));
 const event = {action:'interrupt',eventId:crypto.randomUUID(),externalCallId:'fixture-ended',callId:crypto.randomUUID()};
 const file = path.join(folder, event.eventId + '.event.json');
 fs.writeFileSync(file, JSON.stringify(event));
 let attempts = 0;
 const bridge = createBridge({...config(folder),fetchImpl:async()=>{attempts++;return Response.json({}, {status:409});}});
 try {
  await bridge.flushEvents();
  assert.equal(attempts, 0);
  assert.equal(fs.existsSync(file), false);
 } finally {
  bridge.close();
  fs.rmSync(folder, {recursive:true,force:true});
 }
});
test('a pending dialer confirmation is retried in under one second and keeps its event ID', async () => {
 const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shahvex-fast-confirmation-'));
 const event = {action:'ended',eventId:crypto.randomUUID(),externalCallId:'fixture-ended',callId:crypto.randomUUID()};
 const file = path.join(folder, event.eventId + '.event.json');
 fs.writeFileSync(file, JSON.stringify(event));
 const attempts = [];
 const bridge = createBridge({...config(folder),fetchImpl:async(_url,init)=>{
  attempts.push({id:JSON.parse(init.body).eventId,at:Date.now()});
  return Response.json(attempts.length===1?{saved:true,syncPending:true,cleanupPending:true}:{saved:true});
 }});
 try {
  await bridge.flushEvents();
  const deadline = Date.now() + 900;
  while (attempts.length < 2 && Date.now() < deadline) await new Promise(r=>setTimeout(r,10));
  assert.equal(attempts.length, 2);
  assert.ok(attempts[1].at-attempts[0].at<900);
  assert.ok(attempts.every(attempt=>attempt.id===event.eventId));
  assert.equal(fs.existsSync(file), false);
 } finally {
  bridge.close();
  fs.rmSync(folder, {recursive:true,force:true});
 }
});
test('database outage retries are bounded and preserve every saved event',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-outage-'));let attempts=0;
 for(let i=0;i<12;i++){const value={action:'retry-sync',eventId:crypto.randomUUID(),externalCallId:'fixture-'+i,callId:crypto.randomUUID()};fs.writeFileSync(path.join(folder,value.eventId+'.event.json'),JSON.stringify(value));}
 const b=createBridge({...config(folder),fetchImpl:async()=>{attempts++;return Response.json({error:'database unavailable'},{status:503});}});
 try{await b.flushEvents();assert.equal(attempts,3);await b.flushEvents();assert.equal(attempts,3);assert.equal(fs.readdirSync(folder).filter(n=>n.endsWith('.event.json')).length,12);}finally{b.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('a waiting call reuses its pending sync event and fresh lifecycle and recording events bypass background backoff',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-outage-call-')),uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');let sync=0,ended=0,recordings=0,socket;
 const b=createBridge({...config(folder),resolveRegistration:async()=>({uuid,audioUuid:uuid,agentUser:'78601',externalCallId:external}),fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});if(v.action==='turn')return new Response('{"type":"done"}\n');if(v.action==='retry-sync')sync++;if(v.action==='ended')ended++;if(v.action==='recording'){recordings++;assert.equal(v.aiRecordingId,uuid);assert.ok(fs.existsSync(path.join(folder,'recordings',uuid+'.wav')));return Response.json({saved:true});}return Response.json({error:'database unavailable'},{status:503});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));await new Promise(r=>setTimeout(r,2200));assert.equal(sync,1);const pending=fs.readdirSync(folder).filter(n=>n.endsWith('.event.json')).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n))));assert.equal(pending.filter(v=>v.action==='retry-sync').length,1);socket.destroy();const deadline=Date.now()+1000;while((!ended||!recordings)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(ended,1);assert.equal(recordings,1);await b.flushEvents();assert.equal(ended,1);}finally{socket?.destroy();b.close();await new Promise(r=>setTimeout(r,30));fs.rmSync(folder,{recursive:true,force:true});}
});
