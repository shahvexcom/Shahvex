const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
process.env.SHAHVEX_OPENING_CACHE_REVISION='handoff-test-'+process.pid;
const {createTesterService}=require('../gateway/tester-service.cjs');
const {customerRequestsHuman,transferConsent}=require('../gateway/handoff-intent.cjs');
const {recoveryReply}=require('../gateway/conversation-recovery.cjs');
const assistant=content=>({role:'assistant',content}),user=content=>({role:'user',content});
const history=[assistant('Would you like me to connect you with a licensed specialist?'),user('Okay.'),assistant('Alright, please wait.')];
const correction="No, you ask me you need to connect with me on license again. I'm waiting for that.";
test('recorded waiting correction retains handoff intent without inventing consent for an unrelated sentence',()=>{
 assert.equal(customerRequestsHuman(correction,history),true);assert.equal(transferConsent([...history,user(correction)]),true);
 assert.equal(customerRequestsHuman(correction,[]),false);
 assert.equal(customerRequestsHuman("I don't want you to connect me. I'm waiting for someone else.",history),false);
 assert.equal(recoveryReply(history),'');assert.equal(recoveryReply([...history,assistant("I'm sorry you'd like to end the call."),user('Bye bye.')]),'');
});
test('waiting noise, ambiguous refusal, and correction never invoke clarification or replay goodbye',async()=>{
 const original=global.fetch;let models=0;
 global.fetch=async url=>{if(String(url).includes('11434')){models++;throw Error('No model needed for handoff state');}return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});};
 const secret='waiting-state-regression-'.repeat(3),service=createTesterService({secret,testHooks:true});let id;
 const call=(action,body)=>service.dispatch(new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'waiting-regression','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)}));
 const turn=async text=>{const events=(await(await call('turn',{text})).text()).trim().split('\n').map(JSON.parse);assert.equal(events.some(e=>e.type==='error'||e.type==='end_call'),false,JSON.stringify(events));return events.filter(e=>e.type==='delta').map(e=>e.text).join('');};
 try{
  id=(await(await call('start',{agentId:'fixture',config:{name:'Waiting fixture',voice:'voice',first:'ai',goal:'',task:'',instructions:'',script:'Connect you with a licensed specialist.',knowledge:'',style:'Natural'}})).json()).id;
  service.sessionStore.get(id).messages.push(...history);
  assert.equal(await turn('Oh yeah, yeah, yeah.'),'');
  assert.equal(await turn("I won't do that."),'');
  service.sessionStore.get(id).messages.push(assistant("I'm sorry you'd like to end the call. Thank you for your time."),user('Bye bye.'));
  assert.equal(await turn(correction),"I don't have confirmation of a completed transfer yet.");
  assert.equal(await turn(correction),'');assert.equal(models,0);
 }finally{if(id)await call('stop',{});global.fetch=original;}
});
