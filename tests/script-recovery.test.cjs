const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
const secret='script-recovery-test-secret-'.repeat(3);
const config={name:'Lauren',voice:'voice',first:'customer',goal:'Review options',task:'Ask the script questions',instructions:'',script:'Hello, this is Lauren from Wellness Team.\nAre you getting a rebate?\nAre you between 60 and 80 years old?\nDo you have coverage?',knowledge:'',style:'Natural'};
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
function req(action,id,body){return new Request('http://local/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'recovery','x-shahvex-session':id||'none','content-type':'application/json'},body:JSON.stringify(body)});}
async function scenario(history,text,modelReply,profile={}){
 const original=global.fetch;let modelCalls=0;
 global.fetch=async(url,init)=>{
  if(String(url).includes('11434')){modelCalls++;return new Response(JSON.stringify({message:{content:modelReply},done:true})+'\n');}
  return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const {dispatch,sessionStore}=createTesterService({secret,testHooks:true});let id;
 try{
  id=(await(await dispatch(req('start',null,{agentId:'a',config:{...config,...profile}}))).json()).id;
  sessionStore.get(id).messages.push(...history);
  const events=(await(await dispatch(req('turn',id,{text}))).text()).trim().split('\n').map(JSON.parse);
  assert.ok(!events.some(e=>e.type==='error'),JSON.stringify(events));
  return {text:events.filter(e=>e.type==='delta').map(e=>e.text).join(''),modelCalls,events};
 }finally{if(id)await dispatch(req('stop',id,{}));global.fetch=original;}
}
test('repeat request after a silence check repeats the actual script question without inference',async()=>{
 const r=await scenario([A('Are you getting a rebate?'),A('Are you still there?')],'Hello. What did you say?','BAD');
 assert.equal(r.text,'Are you getting a rebate?');assert.equal(r.modelCalls,0);
});
test('identity detour answers identity and resumes the unanswered age question without restarting greetings',async()=>{
 const r=await scenario([A('Are you getting a rebate?'),U('Yes.'),A('Are you between 60 and 80 years old?')],'Why are you asking me that? Who are you?','BAD');
 assert.match(r.text,/Lauren.*Wellness Team/);assert.match(r.text,/60 and 80/);assert.doesNotMatch(r.text,/How are you|coverage/);assert.equal(r.modelCalls,0);
});
test('an asked but unanswered question is not removed from a generated clarification',async()=>{
 const r=await scenario([A('Are you getting a rebate?'),U('Yes.'),A('Are you between 60 and 80 years old?')],'I am not sure what age you need.','Are you between 60 and 80 years old?');
 assert.match(r.text,/60 and 80/);
});
test('presence confirmation resumes the pending question and is not saved as its answer',async()=>{
 const r=await scenario([A('Are you between 60 and 80 years old?'),A('Are you still there?')],"Yes, I'm here.",'BAD');
 assert.equal(r.text,"I'm here. Are you between 60 and 80 years old?");assert.equal(r.modelCalls,0);
});
test('quiet complaint gets a direct response and the pending question instead of unclear speech fallback',async()=>{
 const r=await scenario([A('Do you have coverage?')],'Why you are quiet?','BAD');
 assert.equal(r.text,"I'm here. Do you have coverage?");assert.equal(r.modelCalls,0);
});

test('automated voicemail greeting ends the call silently before model inference',async()=>{
 const r=await scenario([A('Hello, this is Lauren. How are you today?')],'All has been forwarded to an automatic voice message system. 12282279143 is not available.','BAD');
 assert.equal(r.text,'');assert.equal(r.modelCalls,0);assert.ok(r.events.some(e=>e.type==='end_call'&&e.reason==='voicemail'));assert.ok(!r.events.some(e=>e.type==='pcm'));
});

test('repetition complaints never repeat identity, pitch or qualification questions',async()=>{
 for(const text of ['Why are you saying again and again?','You already told me that. Why you are saying again?',"Don't tell me this.",'Why are you telling me again and again your name?']){
  const r=await scenario([A("I'm Lauren from Wellness Team. Are you between 60 and 80 years old?")],text,'BAD');
  assert.equal(r.text,"You're right. I'll stop repeating that.");assert.equal(r.modelCalls,0);
 }
});
test('spoken script name is blocked even when the saved profile name differs',async()=>{
 const r=await scenario([A("I'm Lauren from Wellness Team. Are you getting a rebate?")],'Yes, I am getting it.',"I'm Lauren with Wellness Team. Do you have coverage?",{name:'Emily'});
 assert.equal(r.text,' Do you have coverage?');assert.doesNotMatch(r.text,/Lauren|Wellness/);
});
