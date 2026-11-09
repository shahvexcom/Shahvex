const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTesterService } = require('../gateway/tester-service.cjs');
const secret = 'test-secret-'.repeat(4);
const config = { name:'Test',voice:'voice',first:'ai',goal:'',task:'',instructions:'',script:'Help with bookings.',knowledge:'',style:'Professional' };
function request(action, owner, body, id, key=secret) {
  return new Request(`http://localhost/tester/${action}`, {method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':owner,'x-shahvex-session':id||'none','content-type':'application/json'},body:JSON.stringify(body)});
}
test('persistent tester enforces service authentication, capacity, ownership and stop lifecycle',async()=>{
  const { dispatch }=createTesterService({secret,maxSessions:1});
  assert.equal((await dispatch(request('start','owner-a',{agentId:'a',config},undefined,'wrong'))).status,401);
  assert.equal((await dispatch(request('start','owner-a',{agentId:'a',config:{}}))).status,400);
  const started=await dispatch(request('start','owner-a',{agentId:'a',config}));assert.equal(started.status,200);
  const {id}=await started.json();
  assert.equal((await dispatch(request('start','owner-b',{agentId:'b',config}))).status,429);
  assert.equal((await dispatch(request('stop','owner-b',{},id))).status,404);
  assert.equal((await dispatch(request('interrupt','owner-a',{},id))).status,200);
  assert.equal((await dispatch(request('stop','owner-a',{},id))).status,200);
  assert.equal((await dispatch(request('turn','owner-a',{opening:true},id))).status,404);
  const second=await dispatch(request('start','owner-b',{agentId:'b',config}));assert.equal(second.status,200);
  await dispatch(request('stop','owner-b',{},(await second.json()).id));
});
test('HTTP service rejects anonymous session requests',async()=>{
  const {server}=createTesterService({secret});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { const r=await fetch(`http://127.0.0.1:${server.address().port}/tester/start`,{method:'POST',body:'{}'});assert.equal(r.status,401); }
  finally {await new Promise(resolve=>server.close(resolve));}
});
test('same owner can switch agents; abandoned leases free capacity and live heartbeats retain it',async()=>{
  const {dispatch}=createTesterService({secret,leaseMs:100});
  const first=await(await dispatch(request('start','switch-owner',{agentId:'a',config}))).json();
  const second=await(await dispatch(request('start','switch-owner',{agentId:'b',config}))).json();
  assert.notEqual(first.id,second.id);
  assert.equal((await dispatch(request('ping','switch-owner',{},first.id))).status,404);
  assert.equal((await dispatch(request('ping','switch-owner',{},second.id))).status,200);
  assert.equal((await dispatch(request('start','other-owner',{agentId:'c',config}))).status,429);
  await new Promise(resolve=>setTimeout(resolve,120));
  const next=await dispatch(request('start','other-owner',{agentId:'c',config}));assert.equal(next.status,200);
  await dispatch(request('stop','other-owner',{},(await next.json()).id));
});
test('PC tester streams existing PCM protocol, remembers follow-ups and rejects duplicate turns',async()=>{
  const previous=global.fetch;
  const prompts=[];
  global.fetch=async(url,init)=>{
    if(String(url).includes('11434')) {
      prompts.push(JSON.parse(init.body).messages);
      return new Response(JSON.stringify({message:{content:'Hello. I can help with bookings.'},done:true})+'\n');
    }
    return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
  };
  try {
    const {dispatch}=createTesterService({secret});
    const {id}=await (await dispatch(request('start','owner-a',{agentId:'a',config}))).json();
    const turn=(body,turnId)=>{const r=request('turn','owner-a',body,id);r.headers.set('x-shahvex-turn',turnId);return dispatch(r);};
    const first=await turn({opening:true},'opening');
    const events=(await first.text()).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e=>e.type==='pcm'&&e.sampleRate===24000),JSON.stringify(events));
    assert.ok(events.some(e=>e.type==='done'));
    assert.ok(!events.some(e=>e.type==='user'));
    const follow=await turn({text:'What did you say?'},'followup');await follow.text();
    assert.ok(prompts[1].some(m=>m.role==='assistant'&&m.content.includes('bookings')));
    assert.equal((await turn({text:'again'},'followup')).status,409);
    await dispatch(request('stop','owner-a',{},id));
  } finally {global.fetch=previous;}
});
test('live PC session emits audible PCM through existing engines', {skip:process.env.SHAHVEX_LIVE_PC_TESTER!=='1'},async()=>{
  const voices=await (await fetch('http://127.0.0.1:8767/voices')).json();
  const voice=voices.voices.find(v=>v.selectable);
  assert.ok(voice,'An existing selectable voice is required');
  const {dispatch}=createTesterService({secret});
  const {id}=await (await dispatch(request('start','live-owner',{agentId:'live-test',config:{...config,voice:voice.id}}))).json();
  try {
    const r=await dispatch(request('turn','live-owner',{text:'Say hello in one short sentence.'},id));
    const events=(await r.text()).trim().split('\n').map(JSON.parse);
    assert.ok(!events.some(e=>e.type==='error'),JSON.stringify(events.filter(e=>e.type==='error')));
    assert.ok(events.some(e=>e.type==='pcm'&&Buffer.from(e.data,'base64').length>0));
    assert.ok(events.some(e=>e.type==='done'));
  } finally {await dispatch(request('stop','live-owner',{},id));}
});
test('interrupt aborts in-flight inference and permits a subsequent turn',async()=>{
  const previous=global.fetch;
  let observedAbort=false;
  global.fetch=async(url,init)=>new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>{observedAbort=true;setTimeout(()=>reject(Error('cancelled')),50);},{once:true});
  });
  const {dispatch}=createTesterService({secret});
  const {id}=await (await dispatch(request('start','cancel-owner',{agentId:'a',config}))).json();
  try {
    const pending=await dispatch(request('turn','cancel-owner',{text:'hello'},id));
    assert.equal((await dispatch(request('turn','cancel-owner',{text:'overlap'},id))).status,409);
    const cancelStarted=Date.now();
    assert.equal((await dispatch(request('interrupt','cancel-owner',{},id))).status,200);
    assert.ok(Date.now()-cancelStarted>=40,'Interrupt must wait for inference cleanup before acknowledging');
    await pending.text();assert.equal(observedAbort,true);
    const next=await dispatch(request('turn','cancel-owner',{text:'again'},id));assert.equal(next.status,200);
    await dispatch(request('stop','cancel-owner',{},id));await next.text();
  } finally {global.fetch=previous;await dispatch(request('stop','cancel-owner',{},id));}
});
