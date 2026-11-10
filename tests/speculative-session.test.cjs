const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {speechWav}=(()=>{const fs=require('fs'),ts=require('typescript'),m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test-audio.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(require,m,m.exports);return m.exports;})();
test('drafts isolate history, authenticate ownership, commit once and discard resumed speech',async()=>{
 const original=global.fetch;
 global.fetch=async(url)=>String(url).includes('8766')?Response.json({text:'I want Friday.'}):String(url).includes('11434')?new Response(JSON.stringify({message:{content:'Friday is requested.'},done:true})+'\n'):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const key='draft-tests-'.repeat(4),{dispatch,sessionStore}=createTesterService({secret:key,testHooks:true});
 let id;
 async function call(action,token,owner='draft-owner',body='{}',audio=false){return dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':owner,'x-shahvex-session':id||'none','x-shahvex-turn':token||'t','content-type':audio?'audio/wav':'application/json'},body}));}
 try{
  id=(await(await call('start','t','draft-owner',JSON.stringify({agentId:'draft',config:{name:'Test',voice:'v',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Professional'}}))).json()).id;
  const wav=Buffer.from(await speechWav(Array.from({length:20},()=>Int16Array.from({length:320},(_,i)=>Math.round(Math.sin(i/5)*4000)))).arrayBuffer());
  const r=await call('draft','discard','draft-owner',wav,true);assert.equal(r.status,200);await r.text();
  assert.equal(sessionStore.get(id).messages.length,1);assert.equal(sessionStore.get(id).busy,true);
  assert.equal((await call('commit','discard','intruder')).status,404);
  assert.equal((await call('commit','wrong')).status,409);
  assert.equal((await call('cancel','discard')).status,200);assert.equal(sessionStore.get(id).messages.length,1);assert.equal(sessionStore.get(id).busy,false);
  const next=await call('draft','commit','draft-owner',wav,true);await next.text();assert.equal((await call('commit','commit')).status,200);
  assert.equal(sessionStore.get(id).messages.filter(m=>m.role==='user').length,1);assert.equal(sessionStore.get(id).messages.at(-1).content,'Friday is requested.');
  assert.equal((await call('commit','commit')).status,409);assert.equal(sessionStore.get(id).busy,false);
 }finally{if(id)await call('stop');global.fetch=original;}
});
test('interrupt waits for an active draft worker and never commits its partial history',async()=>{
 const original=global.fetch;let sawAbort=false;
 global.fetch=async(url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>{sawAbort=true;setTimeout(()=>reject(Error('cancelled')),25);},{once:true});});
 const key='active-draft-'.repeat(4),{dispatch,sessionStore}=createTesterService({secret:key,testHooks:true});let id;
 const call=(action,body='{}',audio=false)=>dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'cancel-owner','x-shahvex-session':id||'none','x-shahvex-turn':'active','content-type':audio?'audio/wav':'application/json'},body}));
 try{
  id=(await(await call('start',JSON.stringify({agentId:'cancel',config:{name:'Test',voice:'v',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Professional'}}))).json()).id;
  const wav=Buffer.from(await speechWav(Array.from({length:20},()=>Int16Array.from({length:320},(_,i)=>Math.round(Math.sin(i/5)*4000)))).arrayBuffer());
  const r=await call('draft',wav,true);await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await call('interrupt')).status,200);await r.text();assert.equal(sawAbort,true);assert.equal(sessionStore.get(id).busy,false);assert.equal(sessionStore.get(id).messages.length,1);
 }finally{if(id)await call('stop');global.fetch=original;}
});
test('confirmed interrupted drafts retain the heard customer turn and partial answer',async()=>{
 const original=global.fetch;
 global.fetch=async(url,init)=>{
  if(String(url).includes('8766'))return Response.json({text:'Change it to Friday.'});
  if(String(url).includes('11434'))return new Response(JSON.stringify({message:{content:'Friday is requested.'},done:true})+'\n');
  return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 };
 const key='heard-draft-'.repeat(4),{dispatch,sessionStore}=createTesterService({secret:key,testHooks:true});let id;
 const call=(action,body='{}',audio=false)=>dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'heard-owner','x-shahvex-session':id||'none','x-shahvex-turn':'heard','content-type':audio?'audio/wav':'application/json'},body}));
 try{
  id=(await(await call('start',JSON.stringify({agentId:'heard',config:{name:'Test',voice:'v',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Professional'}}))).json()).id;
  const wav=Buffer.from(await speechWav(Array.from({length:20},()=>Int16Array.from({length:320},(_,i)=>Math.round(Math.sin(i/5)*4000)))).arrayBuffer());
  const r=await call('draft',wav,true);await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal((await call('commit')).status,200);assert.equal((await call('interrupt')).status,200);await r.text();
  assert.equal(sessionStore.get(id).messages.filter(m=>m.role==='user').at(-1).content,'Change it to Friday.');
  assert.match(sessionStore.get(id).messages.at(-1).content,/Friday.*interrupted/);assert.equal(sessionStore.get(id).busy,false);
 }finally{if(id)await call('stop');global.fetch=original;}
});
test('a late cancelled upload cannot acquire a session or cancel a newer draft',async()=>{
 const original=global.fetch;global.fetch=async(url)=>String(url).includes('8766')?Response.json({text:'Friday please.'}):String(url).includes('11434')?new Response(JSON.stringify({message:{content:'Friday is requested.'},done:true})+'\n'):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const key='late-draft-'.repeat(4),{dispatch,sessionStore}=createTesterService({secret:key,testHooks:true});let id;
 const call=(action,token,body='{}',audio=false)=>dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'late-owner','x-shahvex-session':id||'none','x-shahvex-turn':token,'content-type':audio?'audio/wav':'application/json'},body}));
 try{
  id=(await(await call('start','new',JSON.stringify({agentId:'late',config:{name:'Test',voice:'v',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Professional'}}))).json()).id;
  assert.equal((await call('cancel','old')).status,200);
  const wav=Buffer.from(await speechWav(Array.from({length:20},()=>Int16Array.from({length:320},(_,i)=>Math.round(Math.sin(i/5)*4000)))).arrayBuffer());
  const current=await call('draft','new',wav,true);assert.equal(current.status,200);
  assert.equal((await call('cancel','old')).status,200);
  const late=await call('draft','old',wav,true);assert.equal(late.status,409);assert.equal((await late.json()).code,'CANCELLED_DRAFT');
  assert.equal((await call('turn','old',JSON.stringify({text:'old speech'}))).status,409);
  await current.text();assert.equal((await call('commit','new')).status,200);assert.equal(sessionStore.get(id).busy,false);assert.equal(sessionStore.get(id).messages.filter(m=>m.role==='user').length,1);
 }finally{if(id)await call('stop','new');global.fetch=original;}
});
