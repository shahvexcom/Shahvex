const {test}=require('node:test'),assert=require('node:assert/strict');
const {fastCompletion,classifyCompletion}=require('../gateway/turn-completion.cjs');
const {transferConsent}=require('../gateway/handoff-intent.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const q1='Are you currently getting any rebate or money back on a card each month?',q2='Do you currently have Medicare Part A or Part B or Medicaid?';
test('completion uses quick complete replies, unfinished thought holds and a bounded semantic inference',async()=>{
 for(const text of ['Yes.','Hello','Hmm','Hang up the call.','I have Medicaid.'])assert.equal(fastCompletion(text).state,'complete',text);
 assert.equal(fastCompletion('I have').state,'incomplete');assert.equal(fastCompletion('Because...').state,'incomplete');assert.equal(fastCompletion('Hold on please').state,'wait');
 let input;assert.equal((await classifyCompletion('The one we discussed yesterday',q1,async x=>(input=x,'COMPLETE'))).state,'complete');assert.equal(input.pendingQuestion,q1);
 assert.equal((await classifyCompletion('A more complex unfinished thought',q1,async()=>{throw Error('offline');})).state,'uncertain');
});
test('hmm means transfer acceptance only immediately after a real connection offer',()=>{
 for(const word of ['yes','yep','okay','hmm','mm-hmm']){
 assert.equal(transferConsent([{role:'assistant',content:'Let me connect you with a licensed specialist.'},{role:'user',content:word}]),true,word);
 assert.equal(transferConsent([{role:'assistant',content:'How are you today?'},{role:'user',content:word}]),false,word);}
});
test('normal tester restarts complete intro, joins identity to pending question, consumes hearing confirmation and silently accepts transfer',async()=>{
 const original=global.fetch,secret='v7-turn-fixture-'.repeat(4);let id;
 global.fetch=async url=>String(url).includes('11434')?new Response(JSON.stringify({message:{content:'I am calling to discuss a coverage review. '+q1},done:true})+'\n'):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v7-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async body=>{const r=await service.dispatch(request('turn',body));assert.equal(r.status,200);const e=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(e.filter(v=>v.type==='error'),[]);return {events:e,text:e.filter(v=>v.type==='delta').map(v=>v.text).join(''),id:e.find(v=>v.type==='done').turnId};};
 try{
 id=(await(await service.dispatch(request('start',{agentId:'v7-agent',requirePlaybackAck:true,config:{name:'Lauren',voice:'v7-turn-fixture',first:'ai',goal:'Discuss coverage review',task:'Ask the configured questions',instructions:'',script:'Hi, this is Lauren from Medicare Wellness Support Team. I am calling about a coverage review.\n'+q1+'\n'+q2+'\nAre you between 60 and 80 years old?\nLet me connect you with a licensed specialist.',knowledge:'',style:'Natural'}}))).json()).id;
 await turn({opening:true});await service.dispatch(request('interrupt',{}));const intro=await turn({text:'Who are you?'});assert.equal(intro.text,'Hi, this is Lauren from Medicare Wellness Support Team. How are you doing today?');
 await service.dispatch(request('playback-complete',{completedTurnId:intro.id}));const purpose=await turn({text:'Okay'});assert.match(purpose.text,/calling.*coverage review/);
 const session=service.sessionStore.get(id);session.purposeDelivered=true;
 const identity=await turn({text:'Who are you?'});assert.match(identity.text,/Lauren.*Medicare Wellness Support Team.*rebate/s);
 const next=await turn({text:'No.'});assert.match(next.text,/Part A/);
 const again=await turn({text:'Who are you?'});assert.match(again.text,/Lauren.*Part A/s);assert.doesNotMatch(again.text,/rebate|money back/);
 await turn({silenceStep:2});assert.equal(session.awaitingHearingConfirmation,true);
 const heard=await turn({text:'Yes, I am here.'});assert.equal(session.hearingConfirmed,true);assert.doesNotMatch(heard.text,/Can you hear me|still there/);
 const later=await turn({silenceStep:2});assert.doesNotMatch(later.text,/Can you hear me/);
 const invitation=await turn({text:'Could you end this call please?'});assert.match(invitation.text,/Sir.*two minutes.*May I go ahead/s);
 const end=await turn({text:'Hang up now please.'});assert.equal(end.text,'');assert(end.events.some(e=>e.type==='end_call'&&e.immediate));
 session.endedReason=undefined;session.messages=session.messages.slice(0,1).concat([{role:'assistant',content:'Let me connect you with a licensed specialist.'}]);session.awaitingEndDecision=false;session.endOfferMade=false;
 const accepted=await turn({text:'hmm'});assert.equal(accepted.text,'');assert(!accepted.events.some(e=>e.type==='pcm'));
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
test('final speech probe returns recognized words without an extra semantic hold or committing history',async()=>{
 const original=global.fetch,secret='v7-probe-fixture-'.repeat(4);let id;
 global.fetch=async url=>String(url).includes('8766')?Response.json({text:'I have'}):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true}),owner='v7-probe-owner';
 const headers={'x-shahvex-ai-key':secret,'x-shahvex-owner':owner,'content-type':'application/json'};
 try{
 id=(await(await service.dispatch(new Request('http://fixture/tester/start',{method:'POST',headers,body:JSON.stringify({agentId:'v7-probe',config:{name:'Alex',voice:'v7-probe',first:'customer',goal:'Ask coverage',task:'Ask coverage',instructions:'',script:q2,knowledge:'',style:'Natural'}})}))).json()).id;
 const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);for(let n=44;n<wav.length;n+=2)wav.writeInt16LE(1800,n);
 const response=await service.dispatch(new Request('http://fixture/tester/listen',{method:'POST',headers:{...headers,'content-type':'audio/wav','x-shahvex-session':id,'x-shahvex-turn':crypto.randomUUID(),'x-shahvex-turn-final':'1'},body:wav}));assert.equal(response.status,200);const data=await response.json();assert.equal(data.completion,'complete');assert.equal(data.text,'I have');assert.equal(service.sessionStore.get(id).messages.filter(m=>m.role==='user').length,0);
 }finally{if(id)await service.dispatch(new Request('http://fixture/tester/stop',{method:'POST',headers:{...headers,'x-shahvex-session':id},body:'{}'}));global.fetch=original;}
});

test('shorter versions keep one question identity without collapsing different numeric conditions',()=>{
 const {canonicalQuestion}=require('../gateway/question-memory.cjs');
 assert.equal(canonicalQuestion('Sir, Are you getting any money back on a card each month?',[q1,q2]),q1);
 assert.equal(canonicalQuestion('Are you between 50 and 70 years old?',['Are you between 60 and 80 years old?']),undefined);
});

test('an explicit business answer after a hearing check remains an answer; presence alone does not',()=>{
 const {rememberQuestions}=require('../gateway/question-memory.cjs');
 const h=[{role:'assistant',content:'How old are you?'},{role:'assistant',content:'Sir, Can you hear me?'}];
 assert.equal(rememberQuestions([...h,{role:'user',content:'I am 65.'}]).completed[0].response,'I am 65.');
 assert.equal(rememberQuestions([...h,{role:'user',content:'Yes, I am.'}]).completed.length,0);
});
