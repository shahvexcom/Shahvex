const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='server-only'?{}:n.startsWith('@/lib/')?load('lib/'+n.slice(6)+'.ts',deps):n.startsWith('./')?load('lib/'+n.slice(2)+'.ts',deps):require(n),m,m.exports);return m.exports;}
const audio=load('lib/agent-test-audio.ts'),service=load('lib/agent-test.ts');
const cfg={name:'Test',voice:'voice',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Friendly'};
const speech=()=>Int16Array.from({length:320},(_,i)=>Math.round(Math.sin(i*.17)*2500));
function route(engine){const api=load('lib/agent-test-session.ts',{'@/lib/agent-test':{...service,engine}});return {POST:request=>api.handleTestSession(request,'admin')};}
const request=(id,turnId,body,type='audio/wav')=>new Request(`http://localhost:3000/test?action=turn&id=${id}&turnId=${encodeURIComponent(turnId)}`,{method:'POST',headers:{'Content-Type':type},body});

test('recognized hello and presence checks acknowledge the caller without unclear-speech fallback or script reset',async()=>{
 for(const greeting of ['Hello?','Hello, hello.','Hi!','Are you there?','Hello, can you hear me?']){
  const id=service.newTest('admin','agent',{...cfg,script:'Ask the customer age.',instructions:'Use the assigned script.'});
  const session=service.sessions.get(id);session.messages.push({role:'assistant',content:'Are you between 60 and 80?'},{role:'assistant',content:"I didn't catch that. Could you say it again?"});let modelCalls=0;
  const api=route(async(port)=>{if(port===11434){modelCalls++;throw Error('Greeting must not rely on model fallback');}return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});
  const events=(await(await api.POST(request(id,'greeting-'+greeting.replace(/[^a-z]/gi,''),JSON.stringify({text:greeting}),'application/json'))).text()).split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(modelCalls,0);assert.ok(events.some(e=>e.type==='user'&&e.text===greeting));assert.equal(session.messages.at(-1).content,"Can you hear me clearly?");assert.ok(session.messages.some(m=>m.content==='Are you between 60 and 80?'));assert.equal(session.config.script,'Ask the customer age.');
 }
});

test('unresolved speech asks for clarification once and recognized speech resets the guard',async()=>{
 const id=service.newTest('admin','agent',cfg);let sttText='';
 const api=route(async(port)=>{if(port===8766)return Response.json({text:sttText});if(port===11434)return new Response(JSON.stringify({message:{content:'Understood.'},done:true})+'\n');return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});
 async function send(n){const bytes=await audio.speechWav(Array.from({length:25+n},speech)).arrayBuffer();return (await(await api.POST(request(id,'unclear-'+n,bytes))).text()).split('\n').filter(Boolean).map(JSON.parse);}
 const first=await send(0);assert.ok(first.some(e=>e.type==='delta'));const second=await send(1);assert.ok(second.some(e=>e.type==='rejected'));assert.equal(second.some(e=>e.type==='delta'),false);
 sttText='Hello?';await send(2);assert.equal(service.sessions.get(id).messages.at(-1).content,"Can you hear me clearly?");assert.equal(service.sessions.get(id).unclearSpeechCount,0);
});

test('assigned scripts retain expression demonstrations and direct contextual answers without model waiting loops',async()=>{
 const previous=process.env.SHAHVEX_LISSA_EMOTIONS;process.env.SHAHVEX_LISSA_EMOTIONS='1';
 try{for(const [text,emotion,expected]of [['Please laugh.','laugh',/Yes, I can/],['Can you cry?','sad',/sad-sounding/],['What time is it in Chicago?','neutral',/in Chicago/],["What time is it in Arizona?",'neutral',/Phoenix/],['Where are you calling from?','neutral',/Phoenix/]]){
  const id=service.newTest('admin','agent',{...cfg,voice:'lissa',script:'Hello, this is the assistant with Wellness Team. Ask the customer age.'});const session=service.sessions.get(id);session.messages.push({role:'assistant',content:'Are you between 60 and 80?'});let selected='neutral';
  const api=route(async(port,path,init)=>{assert.notEqual(port,11434);selected=JSON.parse(init.body).emotion||'neutral';return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
  await(await api.POST(request(id,'context-'+text.replace(/[^a-z]/gi,''),JSON.stringify({text}),'application/json'))).text();assert.equal(selected,emotion,text);assert.match(session.messages.at(-1).content,expected);assert.ok(session.messages.some(m=>m.content==='Are you between 60 and 80?'));
 }}finally{if(previous===undefined)delete process.env.SHAHVEX_LISSA_EMOTIONS;else process.env.SHAHVEX_LISSA_EMOTIONS=previous;}
});

test('Ayesha greeting followed by Yes speaks the actual first verification question without an AI assumption',async()=>{
 const script='Hi there. Are you currently getting any rebate or money back on a card each month?\nIf customer says no do you have coverage?';
 const id=service.newTest('admin','agent',{...cfg,name:'Ayesha',script});const session=service.sessions.get(id);session.messages.push({role:'user',content:'Hello?'},{role:'assistant',content:'Hello, this is Ayesha.'});
 const api=route(async(port)=>{assert.notEqual(port,11434,'must not infer that an unasked question was answered');return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 const events=(await(await api.POST(request(id,'initial-ack',JSON.stringify({text:'Yes.'}),'application/json'))).text()).split('\n').filter(Boolean).map(JSON.parse);
 assert.equal(session.messages.at(-1).content,'Are you currently getting any rebate or money back on a card each month?');assert.ok(events.some(e=>e.type==='pcm'));assert.equal(session.config.script,script);service.sessions.delete(id);
});

test('transfer acknowledgments use the requested hold line and vary follow-ups without a model or call-control change',async()=>{
 const id=service.newTest('admin','agent',{...cfg,name:'Zulekha',script:'Ask the customer age, then offer the specialist.'});const session=service.sessions.get(id);
 session.messages.push({role:'assistant',content:'Let me connect you with a licensed specialist who can look up your exact plan that fits you.'});
 const api=route(async(port)=>{assert.notEqual(port,11434);return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 const expected=['Please wait while I connect you to the licensed specialist.','Your connection request is in progress.'];
 for(let i=0;i<expected.length;i++){await(await api.POST(request(id,'transfer-ack-'+i,JSON.stringify({text:i?'I am waiting.':'Okay.'}),'application/json'))).text();assert.equal(session.messages.at(-1).content,expected[i]);}
 assert.equal(session.config.script,'Ask the customer age, then offer the specialist.');service.sessions.delete(id);
});

test('AI-first opening starts synthesis without invoking the language model or waiting for customer speech',async()=>{
 const id=service.newTest('admin','agent',{...cfg,name:'Database Name',first:'ai',script:'Hello, this is Alex from Wellness Team. Ask permission before coverage questions.'});
 const api=route(async(port)=>{assert.notEqual(port,11434,'opening must not wait for model inference');return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 const response=await api.POST(request(id,'ai-opening',JSON.stringify({opening:true}),'application/json'));
 const events=(await response.text()).split('\n').filter(Boolean).map(JSON.parse);
 assert.match(service.sessions.get(id).messages.at(-1).content,/this is Alex from Wellness Team.*How are you/);
 assert.ok(events.some(e=>e.type==='pcm'));assert.ok(!events.some(e=>e.type==='error'));service.sessions.delete(id);
});

test('an early transfer request bypasses qualification speech and repeated waiting becomes silent',async()=>{
 const id=service.newTest('admin','agent',{...cfg,script:'Ask age and state, then transfer to a licensed agent.'});
 const api=route(async(port)=>{assert.notEqual(port,11434,'no model or screening delay after explicit human request');return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 for(const [index,text]of ['Transfer me to the licensed person.','Okay, I am waiting.','I am still waiting.','I am still waiting.'].entries()){
  const events=(await(await api.POST(request(id,'early-transfer-'+index,JSON.stringify({text}),'application/json'))).text()).split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(events.some(e=>e.type==='done'));assert.ok(!events.some(e=>e.type==='error'));
  if(index===0)assert.match(service.sessions.get(id).messages.at(-1).content,/licensed agent/);
  if(index===1)assert.equal(service.sessions.get(id).messages.at(-1).content,'Your connection request is in progress.');
  if(index>=2){assert.ok(!events.some(e=>e.type==='pcm'||e.type==='delta'));}
 }
 const silenceEvents=(await(await api.POST(request(id,'waiting-silence',JSON.stringify({silenceStep:4}),'application/json'))).text()).split('\n').filter(Boolean).map(JSON.parse);
 assert.ok(!silenceEvents.some(e=>e.type==='end_call'||e.type==='pcm'||e.type==='delta'));
 service.sessions.delete(id);
});
test('a casual marriage question gets a light reply and resumes the pending question without a conduct warning',async()=>{
 const id=service.newTest('admin','agent',{...cfg,script:'Ask age and state.'});service.sessions.get(id).messages.push({role:'assistant',content:'Which state do you live in?'});
 const api=route(async(port)=>{assert.notEqual(port,11434);return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 await(await api.POST(request(id,'marriage-detour',JSON.stringify({text:'I want to marry you.'}),'application/json'))).text();
 assert.match(service.sessions.get(id).messages.at(-1).content,/Wedding planning/);assert.equal(service.sessions.get(id).conductWarned,undefined);service.sessions.delete(id);
});

test('non-mutating speech probe classifies backchannels while a voice turn is busy without cancelling or committing it',async()=>{
 const id=service.newTest('admin','agent',cfg),s=service.sessions.get(id);s.busy=true;let aborted=false;s.abort={abort:()=>{aborted=true;}};
 const api=route(async(port)=>{assert.equal(port,8766);return Response.json({text:'Yeah.'});});
 const wav=await audio.speechWav(Array.from({length:20},speech)).arrayBuffer();
 const req=new Request(`http://localhost/test?action=listen&id=${id}`,{method:'POST',headers:{'content-type':'audio/wav'},body:wav});
 const response=await api.POST(req);assert.equal(response.status,200);assert.deepEqual(await response.json(),{text:'Yeah.',kind:'acknowledgment'});assert.equal(aborted,false);assert.equal(s.busy,true);assert.equal(s.messages.length,1);service.sessions.delete(id);
});
test('okay to an age question advances without inventing an age, then missing age is revisited at the end',async()=>{
 const script='May I know your exact age?\nDo you have existing coverage?\nWhich state do you live in?';
 const id=service.newTest('admin','agent',{...cfg,script});const s=service.sessions.get(id);s.messages.push({role:'assistant',content:'May I know your exact age?'});
 const api=route(async(port)=>{assert.notEqual(port,11434);return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
 for(const [i,text]of ['Okay','Hello','Yes','Okay'].entries())await(await api.POST(request(id,'flow-'+i,JSON.stringify({text}),'application/json'))).text();
 const spoken=s.messages.filter(t=>t.role==='assistant').map(t=>t.content);assert.match(spoken[1],/Do you have existing coverage/);assert.equal(spoken[2],'Can you hear me clearly?');assert.equal(spoken[3],spoken[1]);assert.match(spoken[4],/Which state/);service.sessions.delete(id);
});

test('wait a second is a meaningful request and gets a brief acknowledgment without repeating questions',async()=>{const id=service.newTest('admin','agent',cfg);service.sessions.get(id).messages.push({role:'assistant',content:'What is your age?'});const api=route(async(port)=>{assert.notEqual(port,11434);return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});const result=await(await api.POST(request(id,'please-wait',JSON.stringify({text:'Wait a second.'}),'application/json'))).text();assert.match(result,/Of course, take your time/);assert.doesNotMatch(result,/didn.t catch|end_call/);assert.equal(service.sessions.get(id).messages.at(-1).content,'Of course, take your time.');});
test('speech recognition preserves usable short replies instead of replacing them with a longer second decode',async()=>{const bytes=new Uint8Array(await audio.speechWav(Array.from({length:40},speech)).arrayBuffer());let attempts=0;const result=await audio.recognizeSpeechWav(bytes,async()=>{attempts++;return attempts===1?'Um.':'Wait a second.';});assert.equal(result,'Um.');assert.equal(attempts,1);assert.equal(await audio.recognizeSpeechWav(bytes,async()=> 'Yeah.'),'Yeah.');});

test('script intro, reciprocal greeting, purpose and permission precede the first lead question',async()=>{
 const id=service.newTest('admin','agent',{...cfg,name:'Sofia',first:'ai',script:"Hello, this is Sofia from Shahvex. I'm calling about your service appointment.\nWhich day works for you?"});
 const api=route(async port=>{assert.notEqual(port,11434);return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});
 try{
  const turn=async(body,i)=>{const events=(await(await api.POST(request(id,'purpose-flow-'+i,JSON.stringify(body),'application/json'))).text()).split('\n').filter(Boolean).map(JSON.parse);assert.ok(!events.some(e=>e.type==='error'));return service.sessions.get(id).messages.at(-1).content;};
  assert.equal(await turn({opening:true},0),'Hello, this is Sofia from Shahvex. How are you today?');
  assert.equal(await turn({text:'Hello, I am good and how are you today?'},1),"I'm doing well, thank you for asking. I'm calling about your service appointment. Is now a good time for a brief call?");
  const first=await turn({text:'Yes'},2);assert.equal(first,'Thank you. Which day works for you?');
  assert.equal(await turn({text:'Hello?'},3),'Can you hear me clearly?');
  assert.equal(await turn({text:'Yes'},4),first);
 }finally{service.sessions.delete(id);}
});

