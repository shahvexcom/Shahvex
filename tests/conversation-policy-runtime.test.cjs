const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {createRequire}=require('node:module');
const {conductDecision,isHarassment}=require('../gateway/customer-conduct.cjs');
const {createEmotionSelector}=require('../gateway/voice-emotion.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
function load(file,deps={}){
 const filename=path.resolve(file),req=createRequire(filename),m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>Object.hasOwn(deps,name)?deps[name]:name==='server-only'?{}:name.startsWith('./')&&fs.existsSync(path.resolve(path.dirname(filename),name+'.ts'))?load(path.resolve(path.dirname(filename),name+'.ts'),deps):req(name),m,m.exports);return m.exports;
}
const questionSteps=[
 {id:'age',requirement:'Ask age.',kind:'customer_answer',conditional:false},
 {id:'state',requirement:'Ask state.',kind:'customer_answer',conditional:false},
];
const answers=[{role:'assistant',content:'What is your age?'},{role:'user',content:'I am 65.'},{role:'assistant',content:'Which state?'},{role:'user',content:'Kentucky'}];
const checks=[{id:'age',status:'complete',customerEvidence:['I am 65.'],agentEvidence:[]},{id:'state',status:'complete',customerEvidence:['Kentucky'],agentEvidence:[]}];
function results(engine=async()=>{throw Error('Unexpected model request')},query=async()=>({rowCount:1,rows:[]})){
 return load('lib/vicidial-results.ts',{'./agent-test':{engine},'./database':{db:async()=>({query})},'./credential-crypto':{},'./vicidial':{},'./agent-runtime':{},'./vicidial-bridge':{},'./vicidial-config':{}});
}
test('direct harassment gets a calm warning, repeat ends, genuine frustration and reported abuse remain conversations',()=>{
 assert.equal(conductDecision('You sound sexy.').kind,'warn');
 assert.equal(conductDecision('Talk dirty to me.',true).reason,'harassment');
 assert.equal(conductDecision('Please end this call.').reason,'customer_request');
 for(const text of ['This is fucking expensive.','I am angry about the payment.','My prescription affects my sex drive.','Someone said fuck you to me.','Please do not hang up.'])assert.equal(conductDecision(text),null,text);
 assert.equal(isHarassment('Are you naked?'),true);
});
test('harassment, anger and ending cannot receive acoustic laughter even with a playful word',()=>{
 for(const customerText of ['You sound sexy, hahaha.','I am angry, lol.','Please hang up, haha.']){
  const select=createEmotionSelector({voice:'lissa',enabled:true,customerText});
  assert.equal(select('That was funny.'),'neutral',customerText);
 }
});
test('completion requires every step, grounded correct-speaker evidence and justified conditional skips',()=>{
 const r=results();
 assert.equal(r.groundedHandoff(questionSteps,checks,answers),true);
 assert.equal(r.groundedHandoff(questionSteps,checks.slice(0,1),answers),false);
 assert.equal(r.groundedHandoff(questionSteps,[checks[0],{...checks[1],customerEvidence:['What is your age?']}],answers),false);
 assert.equal(r.groundedHandoff(questionSteps,[checks[0],{...checks[1],status:'not_applicable'}],answers),false);
 assert.equal(r.groundedHandoff([{...questionSteps[0],conditional:true}],[{...checks[0],status:'not_applicable',customerEvidence:[]}],answers),false);
 const statement={id:'disclosure',requirement:'I am an AI assistant.',kind:'agent_statement',conditional:false};
 const proof={id:'disclosure',status:'complete',customerEvidence:[],agentEvidence:['I am an AI assistant.']};
 assert.equal(r.groundedHandoff([statement],[proof],[{role:'assistant',content:'I am an AI assistant. [interrupted]'}]),false);
 assert.equal(r.groundedHandoff([statement],[proof],[{role:'assistant',content:'I am an AI assistant.'}]),true);
 const yesChecks=checks.map(c=>({...c,customerEvidence:['Yes.']}));
 assert.equal(r.groundedHandoff(questionSteps,yesChecks,[{role:'user',content:'Yes.'}]),false);
 assert.equal(r.groundedHandoff(questionSteps,yesChecks,[{role:'user',content:'Yes.'},{role:'user',content:'Yes.'}]),true);
});
test('script or conversation changes invalidate a previously complete handoff audit',()=>{
 const r=results(),snapshot={script:'Ask age. Ask state.'};
 const call={script_snapshot:snapshot,conversation_history:answers,qualification:{steps:questionSteps,stepChecks:checks,scriptHash:r.qualificationHash(snapshot),historyHash:r.conversationHash(answers)}};
 assert.equal(r.hasCurrentQualification(call),true);
 assert.equal(r.hasCurrentQualification({...call,script_snapshot:{script:'Ask age. Ask state. Ask medications.'}}),false);
 assert.equal(r.hasCurrentQualification({...call,conversation_history:[...answers,{role:'user',content:'Actually I am 45.'}]}),false);
 assert.equal(r.hasCurrentQualification({...call,qualification:{...call.qualification,steps:[...questionSteps,{id:'invented',requirement:'Invented requirement',kind:'condition',conditional:false}]}}),false);
});
test('goal achieved and explicit early agent request never replace missing qualification',async()=>{
 let count=0,saved;
 const history=[{role:'user',content:'I am 65. Connect me to an agent.'}];
 const r=results(async()=>{
  count++;
  const value=count===1?{steps:questionSteps}:{fields:[],goalAchieved:true,goalEvidence:history[0].content,handoffReady:true,handoffEvidence:[history[0].content],stepChecks:{age:{status:checks[0].status,customerEvidence:checks[0].customerEvidence,agentEvidence:checks[0].agentEvidence},state:{status:'missing',customerEvidence:[],agentEvidence:[]}}};
  return Response.json({message:{content:JSON.stringify(value)}});
 },async(sql,params)=>{saved=params;return {rowCount:1,rows:[]}});
 const result=await r.collectVicidialResult('call',history,JSON.stringify({script:'Ask age. Ask state.'}));
 assert.equal(result.goal,true);assert.equal(result.consent,true);assert.equal(result.handoffReady,false);assert.equal(saved[5],false);
 const audit=JSON.parse(saved[6]);assert.equal(audit.steps.length,2);assert.equal(audit.stepChecks[1].status,'missing');
});
test('ungrounded checklist fails closed before committing or attempting handoff',async()=>{
 let writes=0;
 const r=results(async()=>Response.json({message:{content:JSON.stringify({steps:[{...questionSteps[0],requirement:'A made up requirement'}]})}}),async()=>{writes++;return {rowCount:1}});
 await assert.rejects(r.collectVicidialResult('call',answers,'Ask age.'),/Ungrounded/);assert.equal(writes,0);
});
test('tester warns, ends after repeated harassment, retains early facts and prevents post-end turns without model calls',async()=>{
 const original=global.fetch;let llmCalls=0;
 global.fetch=async(url)=>{
  if(String(url).includes('11434')){llmCalls++;throw Error('Conduct must not use model');}
  return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const secret='runtime-conversation-test-'.repeat(3),{dispatch,sessionStore}=createTesterService({secret,testHooks:true});let id;
 const call=(action,body)=>dispatch(new Request('http://local/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'runtime-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)}));
 try{
  id=(await(await call('start',{agentId:'a',config:{name:'Lisa',voice:'lissa',first:'customer',goal:'Review options',task:'Ask age',instructions:'',script:'Ask age. Ask state.',knowledge:'',style:'Friendly'}})).json()).id;
  const session=sessionStore.get(id);
  session.messages.push({role:'user',content:'My age is 65.'});
  for(let i=0;i<45;i++)session.messages.push({role:i%2?'assistant':'user',content:'A previous conversation turn.'});
  let events=(await(await call('turn',{text:'You sound sexy.'})).text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.type==='pcm'));assert.ok(!events.some(e=>e.type==='end_call'));assert.equal(session.conductWarned,true);
  assert.ok(session.messages.some(m=>m.content==='My age is 65.'));
  events=(await(await call('turn',{text:'Talk dirty to me.'})).text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.type==='end_call'&&e.reason==='harassment'));assert.equal(session.endedReason,'harassment');
  assert.equal((await call('turn',{text:'Okay.'})).status,409);assert.equal(llmCalls,0);
 }finally{if(id)await call('stop',{});global.fetch=original;}
});

test('required availability wording survives streaming when the script authorizes it',async()=>{
 const {streamAgentReply}=load('lib/agent-test-stream.ts');
 const spoken=[],events=[];let answer='';
 await streamAgentReply({allowTimePermission:true,messages:[],voice:'fixture',signal:new AbortController().signal,onText:t=>answer=t,send:async e=>events.push(e),timing:async()=>{},engine:async(port,_path,init)=>{
  if(port===11434)return new Response(JSON.stringify({message:{content:'Do you have a minute?'},done:true})+'\n');
  spoken.push(JSON.parse(init.body).text);return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 }});
 assert.equal(answer,'Do you have a minute?');assert.deepEqual(spoken,['Do you have a minute?']);assert.ok(events.some(e=>e.type==='pcm'));
});
