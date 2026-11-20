const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
const config={name:'Alex',voice:'intro-state-voice',first:'ai',goal:'Discuss home repair needs',task:'Ask about the repair',instructions:'',script:'This is Alex from Repairs. Ask about the customer home repair needs.',knowledge:'',style:'Natural'};
const secret='intro-state-fixture-'.repeat(4);
const pcm=()=>new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
test('a completed synthesis with unfinished audible intro is restarted before any purpose response',async()=>{
 const original=global.fetch;let models=0;
 global.fetch=async(url)=>{
  if(String(url).includes('11434')){models++;return new Response(JSON.stringify({message:{content:'I am calling about the home repairs you would like to discuss. I can ask a few questions about the work and help establish the next step. What repair do you need?'},done:true})+'\n');}
  return pcm();
 };
 const service=createTesterService({secret,testHooks:true});let id;
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'intro-state-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async body=>{const response=await service.dispatch(request('turn',body));assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.filter(e=>e.type==='error'),[]);return events.filter(e=>e.type==='delta').map(e=>e.text).join('');};
 try{
  id=(await(await service.dispatch(request('start',{agentId:'intro-state-agent',config}))).json()).id;
  const initial=await turn({opening:true});assert.match(initial,/Alex.*Repairs/);
  assert.equal(service.sessionStore.get(id).speechPhase,'introduction');
  await service.dispatch(request('interrupt',{}));assert.equal(service.sessionStore.get(id).introRestartPending,true);
  const restarted=await turn({text:'Hello'});assert.match(restarted,/Alex.*Repairs/);assert.notEqual(restarted,initial);assert.doesNotMatch(restarted,/I'm here|calling about|repair needs|hear me/);assert.equal(models,0);
  // Every interrupted intro repeats the complete Hi/name/company/wellbeing wording requested by the operator.
  await service.dispatch(request('interrupt',{}));
  const second=await turn({text:'Hey'});assert.match(second,/Alex.*Repairs/);assert.equal(second,restarted);assert.equal(models,0);
  const purpose=await turn({text:'Yep'});assert.match(purpose,/calling about the home repairs/);assert.equal(models,1);
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
test('an introduction cancelled while TTS is pending retains the restart state',async()=>{
 const original=global.fetch;let entered,block=false;
 const openingCache=require('../gateway/opening-pcm-cache.cjs'),originalGet=openingCache.get;
 openingCache.get=()=>undefined;
 const playing=new Promise(resolve=>entered=resolve);
 global.fetch=async(_url,init)=>{
  if(block){entered();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true}));}
  return pcm();
 };
 const service=createTesterService({secret,testHooks:true});let id;
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'intro-abort-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  id=(await(await service.dispatch(request('start',{agentId:'intro-abort-agent',config}))).json()).id;
  block=true;const response=await service.dispatch(request('turn',{opening:true})),drain=response.text();await playing;
  await service.dispatch(request('interrupt',{}));await drain;assert.equal(service.sessionStore.get(id).introRestartPending,true);
  block=false;const events=(await(await service.dispatch(request('turn',{text:'Hello'}))).text()).trim().split('\n').map(JSON.parse);
  const text=events.filter(e=>e.type==='delta').map(e=>e.text).join('');assert.match(text,/Alex.*Repairs/);assert.doesNotMatch(text,/I'm here|hear me/);
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;openingCache.get=originalGet;}
});
