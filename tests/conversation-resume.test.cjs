const {test}=require('node:test');
const assert=require('node:assert/strict');
const {repairTurn,knownSalutation,applySalutation}=require('../gateway/conversation-resume.cjs');
const {ConversationSilence}=require('../gateway/conversation-silence.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
test('interrupted intro restarts only identity; completed intro moves listening signals to purpose',()=>{
 for(const signal of ['Hello','Yep','Hmm','Well','I am listening','Go ahead']) {
  assert.equal(repairTurn(signal,[A('Hello, this is Alex from Repairs. [interrupted]')]).kind,'introduction');
  assert.equal(repairTurn(signal,[A('This is Alex from Repairs. How are you today?')]).kind,'purpose');
 }
 assert.equal(repairTurn('Please wait',[A('This is Alex from Repairs.')]),undefined);
 assert.equal(knownSalutation([U('I am 70 years old')]),'');
 assert.equal(knownSalutation([U('Please call me ma’am')]),"Ma'am, ");
});
test('customer titles use known identity and correct both scripted and generated address wording',()=>{
 for (const [history,title] of [[[], ''],[[U('I am female')], 'Madam, '],[[U('I am a man')], 'Sir, '], [[U('I am a woman'), U("Don't call me madam")], '']]) {
  assert.equal(knownSalutation(history),title);
  assert.equal(applySalutation('Sir, can you hear me?',title),title+'can you hear me?');
 }
});
test('interrupted questions resume without completing the step or changing transfers',()=>{
 const history=[A('This is Alex from Repairs.'),U('Go ahead'),A('Are you the homeowner? [interrupted]')];
 for(const signal of ['Hello','Hey','Yep','Hmm']) assert.deepEqual(repairTurn(signal,history),{kind:'question',source:'Are you the homeowner?'});
 assert.equal(repairTurn('Yes',[A('Are you the homeowner?')]),undefined);
 assert.equal(repairTurn('Yes',[A('May I connect you to an agent?')]),undefined);
});
test('silence has four playback-aware three-second windows and a final close window',()=>{
 const timer=new ConversationSilence();let time=0;
 for(const [i,delay]of [3000,3000,3000,3000,500].entries()){
  assert.equal(timer.tick(time,false),undefined);
  assert.equal(timer.tick(time+delay-1,false),undefined);
  assert.equal(timer.tick(time+delay,false),i+1);
  timer.tick(time+delay+20,true);time+=delay+100;
 }
 assert.equal(timer.tick(time+9999,false),undefined);
 timer.speech();timer.tick(time,false);assert.equal(timer.tick(time+3000,false),1);
});
test('normal tester path rephrases intro, explains purpose, resumes question, handles silence and honors repeated hangup',async()=>{
 const original=global.fetch;const prompts=[];
 global.fetch=async(url,init)=>{
  if(String(url).includes('11434')){
   const body=JSON.parse(init.body),system=body.messages[0].content;prompts.push(system);
   const text=system.includes('Reintroduce the configured')?'You are speaking with Alex from Repairs.':system.includes('TURN RECOVERY. The customer has acknowledged')?'I am calling about the home repair work you would like to discuss. I can ask a few questions about the work and help establish the next step. Is now a good time?': 'Do you own the home?';
   return new Response(JSON.stringify({message:{content:text},done:true})+'\n');
  }
  return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const secret='conversation-resume-fixture-'.repeat(3),service=createTesterService({secret,testHooks:true,maxSessions:2});let id;
 const call=async(action,body)=>service.dispatch(new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'resume-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)}));
 const turn=async body=>{const r=await call('turn',body);assert.equal(r.status,200);const ev=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(ev.filter(e=>e.type==='error'),[]);return {ev,text:ev.filter(e=>e.type==='delta').map(e=>e.text).join('')};};
 try{
  id=(await(await call('start',{agentId:'resume-agent',config:{name:'Alex',voice:'resume-test-voice',first:'customer',goal:'Discuss requested home repairs',task:'Ask whether the customer owns the home',instructions:'',script:'This is Alex from Repairs. Are you the homeowner?',knowledge:'',style:'Natural'}})).json()).id;
  const session=service.sessionStore.get(id);session.messages.push(A('Hello, this is Alex from Repairs.'));
  await call('interrupt',{});assert.match(session.messages.at(-1).content,/interrupted/);
  assert.match((await turn({text:'Hello'})).text,/Hi, this is Alex.*How are you doing today/);
  assert.match((await turn({text:'Well'})).text,/calling to discuss requested home repairs/);
  session.messages.push(A('Are you the homeowner? [interrupted]'));
  assert.equal((await turn({text:'Yep'})).text,'Are you the homeowner?');
  assert.equal(session.questionAliases.get('Are you the homeowner?'),'Are you the homeowner?');
  const retry=await turn({silenceStep:1});assert.equal(retry.text,'','no automatic question repetition on silence');
  assert.equal((await turn({silenceStep:2})).text,'Can you hear me?');
  assert.match((await turn({silenceStep:3})).text,/Are you still there/);
  const final=await turn({silenceStep:4});assert.match(final.text,/Goodbye/);assert(final.ev.some(e=>e.type==='end_call'));
  const offer=await turn({text:'Please hang up'});assert.match(offer.text,/would you like me to end the call now/i);assert(!offer.ev.some(e=>e.type==='end_call'));
  const goodbye=await turn({text:'Hang up'});assert.equal(goodbye.text,'');assert(goodbye.ev.some(e=>e.type==='end_call'&&e.reason==='customer_request'));
 }finally{if(id)await call('stop',{});global.fetch=original;}
});
test('native hangup is immediate only after the complete invitation playback is acknowledged',async()=>{
 const original=global.fetch;
 global.fetch=async()=>new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const secret='end-invitation-fixture-'.repeat(3),service=createTesterService({secret,testHooks:true});let id;
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'vici-stop-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const dispatch=(action,body)=>service.dispatch(request(action,body));
 const turn=async text=>(await(await dispatch('turn',{text})).text()).trim().split('\n').map(JSON.parse);
 try{
  id=(await(await dispatch('start',{agentId:'stop-agent',requirePlaybackAck:true,config:{name:'Alex',voice:'stop-test-voice',first:'customer',goal:'Help with repairs',task:'',instructions:'',script:'Ask about the repairs.',knowledge:'',style:'Natural'}})).json()).id;
  const first=await turn('Please hang up');
  const firstId=first.find(e=>e.type==='done').turnId;
  assert.match(first.filter(e=>e.type==='delta').map(e=>e.text).join(''),/would you like me to end the call now/i);
  assert.notEqual(service.sessionStore.get(id).endOfferMade,true);
  await dispatch('interrupt',{});
  await dispatch('playback-complete',{completedTurnId:firstId});
  const second=await turn('Hang up');
  assert.ok(second.some(e=>e.type==='end-offer'));
  assert.ok(!second.some(e=>e.type==='end_call'));
  await dispatch('playback-complete',{completedTurnId:second.find(e=>e.type==='done').turnId});
  const ended=await turn('Yes, please');
  assert.ok(ended.some(e=>e.type==='end_call'&&e.immediate));
  assert.ok(!ended.some(e=>e.type==='pcm'));
 }finally{if(id)await dispatch('stop',{});global.fetch=original;}
});
