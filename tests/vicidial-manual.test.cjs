const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createManualBridge,testerTransport,manualCallbacks}=require('../deployment/vicidial-bridge/manual-test-server.cjs');
const {packet,signature,createBridge}=require('../deployment/vicidial-bridge/server.cjs');
const secret='fixture-manual-secret-at-least-32-characters';
const agent={name:'Manual test',voice:'approved-voice',first:'customer',style:'Friendly',script:'Collect the customer name.'};
test('explicit manual-only direct AudioSocket accepts UUID without control registration',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-direct-'));let started=false,socket;
 const manual=createManualBridge({enabled:true,secret,agent,stateDirectory:folder,controlPort:0,audioPort:0,allowUnregisteredAudio:true},{request:async action=>{if(action==='start')started=true;return Response.json(action==='start'?{id:'direct-session',derivedFromScript:true}:{stopped:true});}});
 try{await manual.listen();socket=net.connect(manual.bridge.audio.address().port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));
 const deadline=Date.now()+2000;while(!started&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(started,true);
 }finally{socket?.destroy();await new Promise(r=>setTimeout(r,60));await manual.bridge.flushEvents();await manual.close();fs.rmSync(folder,{recursive:true,force:true});}
});
async function signedRequest(port,url,value,key=secret,method='POST'){
 const body=method==='GET'?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),stamp=String(Date.now());
 return fetch(`http://127.0.0.1:${port}${url}`,{method,headers:{'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(key,stamp,method,url,body)},...(method==='POST'?{body}:{})});
}
test('manual AudioSocket call uses shared tester PCM and cannot submit Native leads or transfers',{timeout:8000},async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-manual-')),operations=[],logs=[];
 const manual=createManualBridge({enabled:true,secret,agent,controlPort:0,audioPort:0,stateDirectory:folder},{logger:value=>logs.push(value),request:async(action,init,owner)=>{
  operations.push(action);assert.match(owner,/^manual-audio-/);assert.ok(['start','listen','turn','stop','interrupt'].includes(action));
  if(action==='start'){const body=JSON.parse(init.body);assert.equal(body.deriveFromScript,true);assert.equal(body.config.script,agent.script);return Response.json({id:'test-session',derivedFromScript:true});}
  if(action==='listen'){assert.equal(init.headers['content-type'],'audio/wav');assert.equal(init.headers['x-shahvex-turn-final'],'1');assert.equal(Buffer.from(init.body).readUInt32LE(24),16000);return Response.json({text:'My name is Alex.',completion:'complete'});}
  if(action==='turn'){assert.equal(init.headers['content-type'],'application/json');if(JSON.parse(init.body).opening)return new Response('{"type":"done"}\n');assert.equal(JSON.parse(init.body).text,'My name is Alex.');return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(1920,12).toString('base64')})+'\n{"type":"done"}\n');}
  return Response.json({stopped:true});
 }});let socket;
 try{
  await manual.listen();const port=manual.bridge.control.address().port;
  assert.equal((await (await signedRequest(port,'/health',null,secret,'GET')).json()).testOnly,true);
  const uuid=crypto.randomUUID(),externalCallId='manual-'+uuid.replaceAll('-','');
  assert.equal((await signedRequest(port,'/register',{uuid,externalCallId:'Y0316001655000402028',agentUser:'manual-test'})).status,409);
  assert.equal((await signedRequest(port,'/register',{uuid,externalCallId,agentUser:'manual-test',manualTest:true})).status,200);
  socket=net.connect(manual.bridge.audio.address().port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));
  const received=[];socket.on('data',data=>received.push(data));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));
  const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(3000,i);
  socket.write(Buffer.concat([...Array.from({length:12},()=>packet(0x10,voice)),...Array.from({length:22},()=>packet(0x10,Buffer.alloc(320)))]));
  const deadline=Date.now()+4000;while(received.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.ok(received.length>=2,JSON.stringify({operations,logs}));assert.ok(operations.includes('turn'));assert.equal(operations[0],'start');
  socket.destroy();await new Promise(r=>setTimeout(r,40));await manual.bridge.flushEvents();assert.ok(operations.includes('stop'));
 }finally{socket?.destroy();await manual.close();assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('shahvex-manual-'));fs.rmSync(folder,{recursive:true,force:true});}
});
test('production bridge refuses manual-test registration even with a valid production signature',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-manual-')),connectionId=crypto.randomUUID();
 const production=createBridge({siteUrl:'https://site.example.test/',connectionId,secret,spoolDir:folder,logger:()=>{},fetchImpl:async()=>Response.json({saved:true})});
 try{await new Promise(r=>production.control.listen(0,'127.0.0.1',r));const port=production.control.address().port;
  await signedRequest(port,'/prepare',{connectionId,remoteUser:'manual-test'});
  const uuid=crypto.randomUUID();assert.equal((await signedRequest(port,'/register',{uuid,externalCallId:'manual-'+uuid.replaceAll('-',''),agentUser:'manual-test',manualTest:true})).status,409);
 }finally{production.close();assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('shahvex-manual-'));fs.rmSync(folder,{recursive:true,force:true});}
});
test('manual transport uses only authenticated tester endpoints and rejects plaintext remote destinations',async()=>{
 assert.throws(()=>testerTransport({url:'http://remote.example.test/',secret}));
 let captured;const request=testerTransport({url:'https://tester.example.test/',secret,cfClientId:'fixture-id',cfClientSecret:'fixture-cf-secret'},async(url,init)=>{captured={url,init};return Response.json({id:'session'});});
 await request('start',{method:'POST',headers:{cookie:'must-not-forward','content-type':'application/json'},body:'{}'},'manual-owner');
 assert.equal(captured.url.pathname,'/tester/start');assert.equal(captured.init.headers.get('x-shahvex-ai-key'),secret);assert.equal(captured.init.headers.get('cookie'),null);assert.equal(captured.init.redirect,'error');
 await assert.rejects(request('update_lead',{},'manual-owner'),/Unsupported/);
 assert.throws(()=>createManualBridge({enabled:false,secret,agent}));
});
test('manual sessions reject transfers and require the shared script-derivation capability',async()=>{
 const operations=[];let supported=false;
 const callbacks=manualCallbacks({agent,request:async action=>{operations.push(action);return Response.json(action==='start'?{id:'session',...(supported?{derivedFromScript:true}:{})}:{stopped:true});}});
 const externalCallId='manual-'+crypto.randomUUID().replaceAll('-',''),dispatch=value=>callbacks.dispatch(null,{body:Buffer.from(JSON.stringify(value))});
 const connect={action:'connected',agentUser:'manual-test',externalCallId};
 assert.equal((await dispatch(connect)).status,503);assert.deepEqual(operations,['start','stop']);supported=true;
 const started=await(await dispatch(connect)).json();
 assert.equal((await dispatch({action:'human-answered',callId:started.callId,externalCallId})).status,409);
 assert.equal((await dispatch({...connect,externalCallId:'manual-'+crypto.randomUUID().replaceAll('-','')})).status,429);
 await callbacks.close();assert.ok(operations.every(action=>['start','stop'].includes(action)));
});

test('local monitor updates the initial script and shows streamed customer/agent text',async()=>{
 const {manualCallbacks}=require('../deployment/vicidial-bridge/manual-test-server.cjs');
 const original={...agent},starts=[];
 const callbacks=manualCallbacks({agent:original,request:async(action,init)=>{
  if(action==='start'){starts.push(JSON.parse(init.body));return Response.json({id:'monitor-session',derivedFromScript:true});}
  if(action==='turn')return new Response('{"type":"user","text":"Can you hear me?"}\n{"type":"delta","text":"Yes, clearly."}\n{"type":"done"}\n');
  return Response.json({stopped:true});
 }});
 const externalCallId='manual-'+crypto.randomUUID().replaceAll('-','');
 const send=value=>callbacks.dispatch('',{body:Buffer.from(JSON.stringify({...value,externalCallId}))});
 try{
  callbacks.monitor({agent:{name:'Local Agent',voice:agent.voice,first:'ai',script:'This is the custom localhost initial script.'}});
  const connected=await (await send({action:'connected',agentUser:'manual-test'})).json();
  assert.equal(starts[0].config.script,'This is the custom localhost initial script.');
  assert.throws(()=>callbacks.monitor({agent:original}),/Finish the current local call/);
  const response=await send({action:'turn',callId:connected.callId,eventId:crypto.randomUUID(),text:'Can you hear me?'});
  await response.text();
  const snapshot=callbacks.monitor();
  assert.equal(snapshot.testOnly,true);assert.equal(snapshot.calls[0].agent_name,'Local Agent');
  assert.deepEqual(snapshot.calls[0].conversation_history,[{role:'user',content:'Can you hear me?'},{role:'assistant',content:'Yes, clearly.'}]);
  assert.equal('sessionId' in snapshot.calls[0],false);
  await send({action:'ended',callId:connected.callId});
  assert.equal(callbacks.monitor().calls[0].status,'COMPLETED');
 }finally{await callbacks.close();}
});

test('local monitor control requires the bridge secret and refuses production bridges',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-monitor-'));
 const manual=createManualBridge({enabled:true,secret,agent:{...agent},controlPort:0,audioPort:0,stateDirectory:folder},{logger:()=>{},request:async()=>Response.json({stopped:true})});
 try{
  await manual.listen();const port=manual.bridge.control.address().port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/local-monitor`)).status,401);
  const read=await signedRequest(port,'/local-monitor',null,secret,'GET');assert.equal(read.status,200);assert.equal((await read.json()).testOnly,true);
  const update=await signedRequest(port,'/local-monitor',{agent:{...agent,script:'Saved initial script for the next customer.'}});assert.equal(update.status,200);
 }finally{await manual.close();fs.rmSync(folder,{recursive:true,force:true});}
});

