const {test}=require('node:test'),assert=require('node:assert/strict');
const {rememberQuestions}=require('../gateway/question-memory.cjs');
const {repairTurn}=require('../gateway/conversation-resume.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const q='Do you currently have Medicare Part A or Part B or Medicaid?';
test('compound presence confirmations never answer a screening question',()=>{
 for(const text of ["Yes, I am here.","Yes, I'm here.","I can hear you."]){
 const h=[{role:'assistant',content:q},{role:'user',content:text}];const m=rememberQuestions(h);assert.equal(m.latestAnswer,null,text);assert.equal(m.pendingQuestion,q,text);}
});
test('an interrupted complete question remains pending through a listening signal',()=>{
 const h=[{role:'assistant',content:q+' [interrupted]'},{role:'user',content:'Hello'}];assert.equal(rememberQuestions(h).pendingQuestion,q);assert.deepEqual(repairTurn('Hello hello',h,'',true),{kind:'question',source:q});
});
test('Sir addressing does not create a second copy of an answered question',()=>{
 const m=rememberQuestions([{role:'assistant',content:q},{role:'user',content:'Hello'},{role:'assistant',content:'Sir, '+q},{role:'user',content:'No.'}]);assert.equal(m.completed.length,1);assert.equal(m.pendingQuestion,null);
});
test('live route does not repeat on silence and resumes the pending question after yes-here',async()=>{
 const original=global.fetch,secret='v5-recovery-fixture-'.repeat(4);let id,models=0;
 global.fetch=async url=>String(url).includes('11434')?(models++,new Response(JSON.stringify({message:{content:models===1?'Are you still there? My last point was the rebate update.':'Do you have Part A, Part B, or Medicaid?'},done:true})+'\n')):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v5-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async body=>{const r=await service.dispatch(request('turn',body));assert.equal(r.status,200);assert.equal(r.headers.get('x-shahvex-flow-revision'),require('../gateway/conversation-resume.cjs').FLOW_REVISION);const e=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(e.filter(v=>v.type==='error'),[]);return e.filter(v=>v.type==='delta').map(v=>v.text).join('');};
 try{
 id=(await(await service.dispatch(request('start',{agentId:'v5-agent',config:{name:'Alex',voice:'v5-recovery-voice',first:'ai',goal:'Discuss coverage',task:'Ask coverage',instructions:'',script:q+'\nAre you between 60 and 80 years old?',knowledge:'',style:'Natural'}}))).json()).id;
 const session=service.sessionStore.get(id);session.messages.push({role:'assistant',content:q});session.purposeDelivered=true;
 const first=await turn({silenceStep:1});assert.equal(first,'');assert.doesNotMatch(first,/still there|last point|hear me/i);
 const check=await turn({silenceStep:2});assert.match(check,/Can you hear me/);
 const resume=await turn({text:'Yes, I am.'});assert.match(resume,/Part A/);assert.doesNotMatch(resume,/still there|last point|hear me|I'm here/i);
 const retry=await turn({silenceStep:1});assert.equal(retry,'');assert.doesNotMatch(retry,/Can you hear me|still there/i);
 const history=session.messages.map(m=>session.questionAliases?.has(m.content)?{...m,content:session.questionAliases.get(m.content)}:m);assert.equal(rememberQuestions(history).completed.length,0);
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
