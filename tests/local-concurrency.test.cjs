const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {manualCallbacks}=require('../deployment/vicidial-bridge/manual-test-server.cjs');
const agent={name:'Fixture',voice:'lissa',first:'customer',script:'Listen to each customer independently.'};
test('three simultaneous local starts reserve capacity, isolate transcripts, and release only their own session',async()=>{
 const pending=[],owners=[],stopped=[];let next=0;
 const c=manualCallbacks({agent:{...agent},maxCalls:3,request:async(action,init,owner)=>{
  if(action==='start'){owners.push(owner);const id='session-'+(++next);await new Promise(r=>pending.push(r));return Response.json({id,derivedFromScript:true});}
  if(action==='turn'){const text=JSON.parse(init.body).text;return new Response(JSON.stringify({type:'user',text})+'\n'+JSON.stringify({type:'delta',text:'Reply to '+text})+'\n');}
  if(action==='stop')stopped.push(init.headers['x-shahvex-session']);return Response.json({saved:true});
 }});
 const ids=Array.from({length:4},()=> 'manual-'+crypto.randomUUID().replaceAll('-',''));
 const send=(i,v)=>c.dispatch('',{body:Buffer.from(JSON.stringify({externalCallId:ids[i],...v}))});
 try{
  const starts=[0,1,2].map(i=>send(i,{action:'connected',agentUser:'manual-test'}));
  assert.equal(pending.length,3);assert.equal((await send(3,{action:'connected',agentUser:'manual-test'})).status,429);
  assert.throws(()=>c.monitor({agent:{...agent}}),/Finish the current local call/);
  pending.splice(0).forEach(r=>r());const responses=await Promise.all(starts);assert.ok(responses.every(r=>r.status===200));
  const calls=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(owners).size,3);
  await Promise.all(calls.map(async(call,i)=>{const r=await send(i,{action:'turn',callId:call.callId,text:'customer-'+i,eventId:crypto.randomUUID()});await r.text();}));
  const snapshot=c.monitor();assert.equal(snapshot.calls.length,3);
  calls.forEach((call,i)=>{const history=snapshot.calls.find(x=>x.id===call.callId).conversation_history;assert.deepEqual(history,[{role:'user',content:'customer-'+i},{role:'assistant',content:'Reply to customer-'+i}]);});
  assert.equal((await send(1,{action:'ended',callId:calls[1].callId})).status,200);assert.deepEqual(stopped,['session-2']);
  const replacement=send(3,{action:'connected',agentUser:'manual-test'});pending.splice(0).forEach(r=>r());assert.equal((await replacement).status,200);
 }finally{await c.close();}
 assert.equal(stopped.length,4);
});
