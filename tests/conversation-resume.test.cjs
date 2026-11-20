const {test}=require('node:test');
const assert=require('node:assert/strict');
const {repairTurn,knownSalutation}=require('../gateway/conversation-resume.cjs');
const {ConversationSilence}=require('../gateway/conversation-silence.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
test('interrupted intro restarts only identity; completed intro moves listening signals to purpose',()=>{
 for(const signal of ['Hello','Yep','Hmm','Well','I am listening','Go ahead']) {
  assert.equal(repairTurn(signal,[A('Hello, this is Alex from Repairs. [interrupted]')]).kind,'introduction');
  assert.equal(repairTurn(signal,[A('This is Alex from Repairs. How are you today?')]).kind,'purpose');
 }
 assert.equal(repairTurn('Please wait',[A('This is Alex from Repairs.')]),undefined);
 assert.equal(knownSalutation([U('I am 70 years old')]),'Sir, ');
 assert.equal(knownSalutation([U('Please call me ma’am')]),"Ma'am, ");
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
  assert.match((await turn({text:'Well'})).text,/calling about the home repair/);
  session.messages.push(A('Are you the homeowner? [interrupted]'));
  assert.equal((await turn({text:'Yep'})).text,'Sir, Do you own the home?');
  assert.equal(session.questionAliases.get('Sir, Do you own the home?'),'Are you the homeowner?');
  const retry=await turn({silenceStep:1});assert.equal(retry.text,'Sir, Do you own the home?');
  assert.equal((await turn({silenceStep:2})).text,'Sir, Can you hear me?');
  assert.match((await turn({silenceStep:3})).text,/Are you still there/);
  const final=await turn({silenceStep:4});assert.match(final.text,/Goodbye/);assert(final.ev.some(e=>e.type==='end_call'));
  const offer=await turn({text:'Please hang up'});assert.match(offer.text,/two minutes/);assert(!offer.ev.some(e=>e.type==='end_call'));
  const goodbye=await turn({text:'Hang up'});assert.equal(goodbye.text,'');assert(goodbye.ev.some(e=>e.type==='end_call'&&e.reason==='customer_request'));
 }finally{if(id)await call('stop',{});global.fetch=original;}
});
test('interrupting the two-minute invitation cannot renew it on a second hangup request',async()=>{
 const original=global.fetch;let invited;const waiting=new Promise(resolve=>invited=resolve);
 global.fetch=async(_url,init)=>{
  const body=JSON.parse(init.body);
  if(body.text.includes('two minutes')){invited();return new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true});});}
  return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const secret='end-invitation-fixture-'.repeat(3),service=createTesterService({secret,testHooks:true});let id;
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'stop-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  id=(await(await service.dispatch(request('start',{agentId:'stop-agent',config:{name:'Alex',voice:'stop-test-voice',first:'customer',goal:'Help with repairs',task:'',instructions:'',script:'Ask about the repairs.',knowledge:'',style:'Natural'}}))).json()).id;
  const first=await service.dispatch(request('turn',{text:'Please hang up'})),drain=first.text();await waiting;
  assert.equal(service.sessionStore.get(id).endOfferMade,true);
  await service.dispatch(request('interrupt',{}));await drain;
  const result=(await(await service.dispatch(request('turn',{text:'Hang up'}))).text()).trim().split('\n').map(JSON.parse);
  assert(result.some(e=>e.type==='end_call'&&e.reason==='customer_request'));
  assert(!result.some(e=>e.type==='delta'&&e.text.includes('two minutes')));
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
