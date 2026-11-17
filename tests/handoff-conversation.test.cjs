const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {transferConsent,customerRequestsHuman}=require('../gateway/handoff-intent.cjs');
const script=`Hi, this is Lauren with Wellness Team. M calling about a benefit review. Are you receiving a rebate?
If customer say yes
Thank you.
If customer says No
Do you currently have Medicare Part A or Part B or Medicaid?
Whatever customer answer,
Are you currently between 60 and 80 years old?
Let me connect you with a licensed specialist who can look up your exact plan.`;
const config={name:'Emily',voice:'lissa',first:'ai',goal:'',task:'',instructions:'',script,knowledge:'',style:'Professional'};
test('complete conversation explains handoff, survives audio recovery, honors refusal, and transfers only on a real request',async()=>{
 const original=global.fetch;let modelCalls=0;
 global.fetch=async(url)=>{if(String(url).includes('11434')){modelCalls++;throw Error('This regression should not need a model');}return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});};
 const secret='handoff-conversation-fixture-'.repeat(3),service=createTesterService({secret,testHooks:true});let id;
 const call=async(action,body)=>{const r=await service.dispatch(new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'ending-regression','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)}));assert.equal(r.status,200);return r;};
 const turn=async text=>{const events=(await(await call('turn',text?{text}:{opening:true})).text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.filter(e=>e.type==='error'),[]);return events.filter(e=>e.type==='delta').map(e=>e.text).join('');};
 try{
  id=(await(await call('start',{agentId:'fixture',config})).json()).id;
  assert.match(await turn(),/Lauren.*How are you/);
  assert.match(await turn("I'm good. How about you?"),/calling about a benefit review.*good time/);
  assert.match(await turn('Yes.'),/receiving a rebate/);
  assert.match(await turn('No.'),/Medicare Part A or Part B or Medicaid/);
  assert.match(await turn('Medicaid.'),/between 60 and 80/);
  const offer=await turn('Yeah.');assert.match(offer,/specialist can look up your exact plan.*Would you like me to connect you/);assert.doesNotMatch(offer,/refund owed|please wait/);
  for(const text of ['Why do you wanna connect me with a licensed agent?','Wait for what?']){
   const reply=await turn(text);assert.match(reply,/specialist can look up your exact plan/);assert.doesNotMatch(reply,/please wait|lost track|repeat it/);assert.equal(transferConsent(service.sessionStore.get(id).messages),false);
  }
  assert.match(await turn('Hello?'),/hear me clearly/);assert.equal(transferConsent(service.sessionStore.get(id).messages),false);
  assert.match(await turn('Yeah, I can.'),/Would you like me to connect you/);assert.equal(transferConsent(service.sessionStore.get(id).messages),false);
  assert.equal(await turn('No.'),'Of course. We can continue here.');assert.equal(transferConsent(service.sessionStore.get(id).messages),false);
  assert.match(await turn('Please connect me with the licensed specialist.'),/please wait/);assert.equal(transferConsent(service.sessionStore.get(id).messages),true);
  assert.equal(modelCalls,0);
 }finally{if(id)await call('stop',{});global.fetch=original;}
});
test('transfer questions in the recorded failed call never constitute consent, even with presence confirmations later',()=>{
 const h=[{role:'assistant',content:'Let me connect you with a licensed specialist.'},{role:'user',content:'Why do you wanna connect me with a licensed agent?'},{role:'assistant',content:'Alright, please wait.'},{role:'user',content:'Wait for what?'},{role:'assistant',content:'Can you hear me clearly?'},{role:'user',content:'Yeah, you can.'}];
 assert.equal(transferConsent(h),false);for(const t of h.filter(t=>t.role==='user'))assert.equal(customerRequestsHuman(t.content),false);
});
