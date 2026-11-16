const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
test('identity direct replies and system rules consistently identify the assistant as AI',()=>{
 const fs=require('node:fs'),ts=require('typescript'),m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='server-only'?{}:require(name),m,m.exports);
 const ai=m.exports;let history=[];
 for(let i=0;i<8;i++){const r=ai.directConversationReply(history,'Are you human?',false,'lissa');assert.match(r.text,/\bAI assistant\b/);assert.doesNotMatch(r.text,/human|not an AI/);history.push({role:'assistant',content:r.text});}
 const busy=ai.directConversationReply([],"I'm busy. Are you an AI?",false,'lissa');assert.equal(busy.text,"I'm an AI assistant.");
 const id=ai.newTest('identity-test','fixture',{name:'Lissa',voice:'lissa',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Natural'});
 try{const prompt=ai.sessions.get(id).messages[0].content;assert.match(prompt,/an AI assistant on a phone call/);assert.doesNotMatch(prompt,/you are an real person|you are a real person|you are not an AI robot/);}finally{ai.sessions.delete(id)}
});
test('casual AI identity is spoken with the approved chuckle; serious questions stay calm with no LLM request',async()=>{
 const original=global.fetch,old=process.env.SHAHVEX_LISSA_EMOTIONS;process.env.SHAHVEX_LISSA_EMOTIONS='1';const calls=[];
 global.fetch=async(url,init)=>{assert.match(String(url),/127\.0\.0\.1:8767\/stream$/);calls.push(JSON.parse(init.body));return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})};
 const key='identity-voice-test-'.repeat(3),{dispatch}=createTesterService({secret:key});let id;
 const call=(action,body)=>dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'identity-owner','x-shahvex-session':id||'none','content-type':'application/json'},body:JSON.stringify(body)}));
 try{
  id=(await(await call('start',{agentId:'identity',config:{name:'Lissa',voice:'lissa',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Natural'}})).json()).id;
  for(const [q,emotion]of [['Are you an AI?','laugh'],['Are you human?','laugh'],['Are you AI? I am worried.','neutral']]){
   const r=await call('turn',{text:q});const events=(await r.text()).trim().split('\n').map(l=>JSON.parse(l));const answer=events.filter(e=>e.type==='delta').map(e=>e.text).join('');assert.match(answer,/AI assistant/);assert.doesNotMatch(answer,/human|not an AI/);assert.equal(calls.at(-1).emotion||'neutral',emotion);
  }
 }finally{if(id)await call('stop',{});global.fetch=original;if(old===undefined)delete process.env.SHAHVEX_LISSA_EMOTIONS;else process.env.SHAHVEX_LISSA_EMOTIONS=old;}
});
