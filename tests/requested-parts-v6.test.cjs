const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {conductDecision}=require('../gateway/customer-conduct.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const cfg={name:'Lauren',voice:'v6-requested-parts',first:'ai',goal:'Explain the coverage review',task:'Ask the script questions',instructions:'',script:'Hi, this is Lauren from Medicare Wellness Support Team. You are a sales representative. I am calling to discuss a coverage review. Are you currently getting any rebate or money back on a card each month?\nDo you currently have Medicare Part A or Part B or Medicaid?\nAre you currently between 60 and 80 years old?',knowledge:'',style:'Natural'};
const q1='Are you currently getting any rebate or money back on a card each month?',q2='Do you currently have Medicare Part A or Part B or Medicaid?';
function audioModule(){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test-audio.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);return m.exports;}
test('a valid short STT reply cannot be replaced by a longer second decode',async()=>{
 const audio=audioModule(),samples=new Int16Array(16000).fill(1800),bytes=new Uint8Array(await audio.speechWav([samples]).arrayBuffer());let calls=0;
 const text=await audio.recognizeSpeechWav(bytes,async()=>++calls===1?'Yes.':'Words the customer never said.');assert.equal(text,'Yes.');assert.equal(calls,1);
});
test('end invitation applies to natural closing variants and a later factual no is not a second refusal',()=>{
 for(const text of ['End call please.','Cut the call.','Hang up the call please.',"That's all."]){assert.equal(conductDecision(text,false,false,false).kind,'offer',text);assert.equal(conductDecision(text,false,true,false).immediate,true,text);}
 assert.equal(conductDecision('No.',false,true,false),null);assert.equal(conductDecision('No.',false,true,true).immediate,true);
 assert.equal(conductDecision("Don't hang up the call.",false,false,false),null);
});
test('requested live parts preserve greeting, purpose, script answers, company role and the one-off end invitation',async()=>{
 const original=global.fetch,secret='requested-v6-fixture-'.repeat(4);let id,models=0;
 global.fetch=async url=>String(url).includes('11434')?(models++,new Response(JSON.stringify({message:{content:models===1?q1:'I am calling to discuss the coverage review in our campaign. '+q1},done:true})+'\n')):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v6-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async body=>{const r=await service.dispatch(request('turn',body));assert.equal(r.status,200);const e=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(e.filter(v=>v.type==='error'),[]);return {events:e,text:e.filter(v=>v.type==='delta').map(v=>v.text).join(''),id:e.find(v=>v.type==='done').turnId};};
 try{
 id=(await(await service.dispatch(request('start',{agentId:'v6-agent',requirePlaybackAck:true,config:cfg}))).json()).id;
 await turn({opening:true});await service.dispatch(request('interrupt',{}));
 const intro=await turn({text:'Hello'});assert.match(intro.text,/^(?:Hi|Hello),/);assert.match(intro.text,/Lauren.*Medicare Wellness Support Team/);assert.match(intro.text,/How (?:are you|is your day)/);
 await service.dispatch(request('playback-complete',{completedTurnId:intro.id}));
 const purpose=await turn({text:'Okay'});assert.match(purpose.text,/calling to discuss/);assert.doesNotMatch(purpose.text,/rebate/);assert.equal(models,0,'purpose is grounded directly in the script; screening starts after permission');
 const session=service.sessionStore.get(id);session.questionAliases=new Map([['Sir, Are you getting any money back on a card each month?',q1]]);
 session.messages=session.messages.slice(0,1).concat([{role:'assistant',content:q1},{role:'assistant',content:'Sir, Are you getting any money back on a card each month? [interrupted]'},{role:'user',content:'No.'},{role:'assistant',content:q2}]);session.purposeDelivered=true;
 const next=await turn({text:'I have Medicaid.'});assert.match(next.text,/between 60 and 80/);assert.doesNotMatch(next.text,/rebate|money back/i);
 const role=await turn({text:'Are you a Medicare representative?'});assert.match(role.text,/Yes.*sales representative.*Medicare Wellness Support Team/);assert.doesNotMatch(role.text,/government|not a Medicare/i);
 const offer=await turn({text:'End call please.'});assert.match(offer.text,/Sir.*two minutes.*end the call.*May I go ahead/s);
 const repeat=await turn({text:'Hang up the call please.'});assert.equal(repeat.text,'');assert(repeat.events.some(e=>e.type==='end_call'&&e.immediate===true));assert(!repeat.events.some(e=>e.type==='pcm'));
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
