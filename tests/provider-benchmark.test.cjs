'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {adapter,cases,plan,gate,run}=require('../gateway/provider-benchmark.cjs');
const idle=()=>({authenticated:true,ready:true,maintenance:true,activeSessions:0,queue:{active:0,pending:0},activeRelays:0,startingRelays:0,noCompetingTests:true,ageMs:0,gpuUsedMiB:3500,ollamaResident:false});
function response(text,type='text/event-stream',chunkSize=3){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=chunkSize)c.enqueue(bytes.slice(i,i+chunkSize));c.close();}}),{headers:{'content-type':type}});}
const sse=text=>`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})}\r\n\r\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\r\n\r\ndata: [DONE]\r\n\r\n`;
test('Groq SSE survives arbitrary byte/UTF8/CRLF boundaries; key only goes to fixed TLS endpoint',async()=>{
  let request;const deltas=[];const a=adapter('groq',{key:'fixture-secret',fetcher:async(url,options)=>{request={url,options};return response(': heartbeat\r\n\r\n'+sse('A café search can help.'));}});
  const r=await a(cases()[0].messages,new AbortController().signal,d=>deltas.push(d));
  assert.equal(r.text,'A café search can help.');assert.equal(deltas.join(''),r.text);assert.equal(request.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(request.options.redirect,'error');
  assert.equal(request.options.headers.Authorization,'Bearer fixture-secret');const body=JSON.parse(request.options.body);assert.equal(body.model,'llama-3.1-8b-instant');assert.equal(body.stream,true);assert.equal(body.max_completion_tokens,120);assert.ok(!('keep_alive'in body));assert.ok(!JSON.stringify(r).includes('fixture-secret'));
});
test('Ollama preserves production request options and terminal telemetry',async()=>{
  let sent;const a=adapter('ollama',{fetcher:async(url,o)=>{sent=JSON.parse(o.body);assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(o.headers.Authorization,undefined);return response('{"message":{"content":"Useful answer."},"done":false}\n{"message":{"content":""},"done":true,"load_duration":1000,"eval_count":3}\n','application/x-ndjson');}});
  const r=await a(cases()[0].messages,new AbortController().signal);assert.deepEqual(Object.keys(sent).sort(),['messages','model','stream']);assert.equal(r.terminal.load_duration,1000);assert.equal(r.terminal.eval_count,3);
});
test('provider failures never echo secret-bearing bodies or raw network errors and do not retry',async()=>{
  for(const status of [401,429,500]){let n=0;const a=adapter('groq',{key:'secret',fetcher:async()=>{n++;return new Response('secret transcript',{status});}});await assert.rejects(a([],new AbortController().signal),new RegExp(`Provider HTTP ${status}`));assert.equal(n,1);}
  const a=adapter('groq',{key:'secret',fetcher:async()=>{throw Error('secret');}});await assert.rejects(a([],new AbortController().signal),e=>!e.message.includes('secret'));
});
test('truncated, malformed, error, over-limit and post-DONE streams fail closed',async()=>{
  const streams=[sse('Hello.').replace('data: [DONE]','data: not-json'),sse('Hello.').replace('data: [DONE]\r\n\r\n',''), 'data: {"error":{"message":"secret"}}\n\n',sse('x'.repeat(16001)),sse('Hello.')+'data: {}\n\n',sse('Hello.').replace('"stop"','"length"')];
  for(const stream of streams){const a=adapter('groq',{key:'fixture',fetcher:async()=>response(stream)});await assert.rejects(a([],new AbortController().signal));}
});
test('client cancellation rejects output and releases response reader',async()=>{
  const c=new AbortController();let cancelled=false;
  const a=adapter('groq',{key:'fixture',fetcher:async()=>new Response(new ReadableStream({start(s){s.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
  await assert.rejects(a([],c.signal,()=>c.abort()),/cancelled/);assert.equal(cancelled,true);
});
test('identical paired scripts, histories and seeded order; no real agent data',()=>{
  assert.deepEqual(plan(),plan());assert.equal(plan().length,10);
  for(const c of cases()){const pair=plan().filter(p=>p.id===c.id);assert.deepEqual(pair[0].messages,pair[1].messages);}
});
test('existing memory gates are not weakened for cloud or local trials',()=>{
  gate(idle(),'ollama',{admission:true});
  for(const patch of [{gpuUsedMiB:4501},{gpuUsedMiB:7808},{authenticated:false},{maintenance:false},{activeSessions:1},{startingRelays:1},{ageMs:4000},{noCompetingTests:false}])assert.throws(()=>gate({...idle(),...patch},'ollama',{admission:true}));
  assert.throws(()=>gate({...idle(),ollamaResident:true},'groq',{admission:true}));gate({...idle(),gpuUsedMiB:4700},'groq',{admission:true});
});
test('no approval means no provider request; blocked memory never invokes local adapter',async()=>{
  let n=0;await assert.rejects(run({snapshot:async()=>idle(),providers:{}}),/approval/);
  const providers={groq:async()=>{n++;return {text:'A useful synthetic response.'};},ollama:async()=>{throw Error('Must not run');}};
  const r=await run({approved:true,providers,snapshot:async()=>({...idle(),gpuUsedMiB:4501})});assert.equal(r.rows.at(-1).status,'blocked');assert.ok(n<10);
});
test('matched mocked text-only run is sequential and records phrases, timing and compliance',async()=>{
  let active=0,peak=0;const call=async(messages,_s,d)=>{active++;peak=Math.max(peak,active);const text=messages.at(-1).content.includes('fees')?'Fees are not provided in this demonstration.':'Use a clear subject keyword, then narrow by location.';d(text);active--;return {text};};
  const r=await run({approved:true,snapshot:async()=>idle(),providers:{groq:call,ollama:call}});assert.equal(r.rows.length,10);assert.equal(peak,1);assert.ok(r.rows.every(x=>x.status==='complete'&&x.firstPhraseMs!==null));assert.ok(r.rows.filter(x=>x.id==='missing').every(x=>x.mandatoryPresent));assert.equal(r.nativeAudio,false);
});
test('unexpected activity during a stream cancels it and prevents subsequent requests',async()=>{
  let checks=0,calls=0,aborted=false;
  const slow=async(_m,signal)=>{calls++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancel'));},{once:true});});};
  const r=await run({approved:true,monitorMs:100,providers:{ollama:slow,groq:slow},snapshot:async()=>++checks===1?idle():{...idle(),activeSessions:1}});
  assert.equal(calls,1);assert.equal(aborted,true);assert.equal(r.rows.length,1);assert.equal(r.rows[0].status,'failed');
});
test('observer timeout fails closed without issuing provider inference',async()=>{
  let calls=0;const r=await run({approved:true,providers:{groq:()=>calls++,ollama:()=>calls++},snapshot:()=>new Promise(()=>{})});
  assert.equal(calls,0);assert.equal(r.rows[0].status,'blocked');assert.match(r.rows[0].reason,/timed out/);
});
test('explicit Groq-only selection cannot invoke Ollama and keeps all five matched inputs',async()=>{
  let calls=0;const r=await run({approved:true,variants:['groq'],snapshot:async()=>({...idle(),gpuUsedMiB:4666}),providers:{groq:async(_m,_s,d)=>{calls++;const text='A concise synthetic answer for review.';d(text);return {text};},ollama:()=>{throw Error('Ollama forbidden');}}});
  assert.equal(calls,5);assert.equal(r.rows.length,5);assert.ok(r.rows.every(row=>row.provider==='groq'));
  await assert.rejects(run({approved:true,variants:['unknown'],snapshot:async()=>idle()}),/provider selection/);
});
test('result retains only safe HTTP classification and never arbitrary provider exception text',async()=>{
  for(const message of ['Provider HTTP 401','private secret exception']){
    const r=await run({approved:true,variants:['groq'],snapshot:async()=>idle(),providers:{groq:async()=>{throw Error(message);}}});
    assert.equal(r.rows.length,1);assert.equal(r.rows[0].error,message==='Provider HTTP 401'?message:'Provider failure; no retry');
  }
});
test('discovered GPT OSS candidate uses low reasoning and retains numeric usage only',async()=>{
  const a=adapter('groq',{key:'fixture',model:'openai/gpt-oss-20b',fetcher:async(_u,o)=>{const b=JSON.parse(o.body);assert.equal(b.model,'openai/gpt-oss-20b');assert.equal(b.reasoning_effort,'low');assert.equal(b.stream_options.include_usage,true);return response(sse('Useful answer.').replace('data: [DONE]', 'data: {"choices":[],"x_groq":{"usage":{"completion_tokens":4,"completion_time":0.01,"private":"excluded"}}}\r\n\r\ndata: [DONE]'));}});
  const r=await a([],new AbortController().signal);assert.deepEqual(r.usage,{completion_tokens:4,completion_time:0.01});
});
test('pre-header connection timeout survives nested cause sanitization without leaking messages',async()=>{
  const a=adapter('groq',{key:'fixture',fetcher:async()=>{throw Object.assign(Error('secret URL and header'),{cause:Object.assign(Error('private'),{code:'UND_ERR_CONNECT_TIMEOUT'})});}});
  await assert.rejects(a([],new AbortController().signal),e=>{assert.equal(e.benchmarkDiagnostic.phase,'before-headers');assert.equal(e.benchmarkDiagnostic.networkCode,'UND_ERR_CONNECT_TIMEOUT');assert.equal(e.benchmarkDiagnostic.timeoutStage,'before-headers');assert.equal(e.benchmarkDiagnostic.clientDeadlineExpired,false);assert.equal(e.benchmarkDiagnostic.deadlineMs,60000);assert.ok(!JSON.stringify(e.benchmarkDiagnostic).includes('private'));return true;});
});
test('GPT OSS reasoning-only events are counted, never forwarded; length exhaustion remains visible',async()=>{
  const reasoning='data: {"choices":[{"index":0,"delta":{"reasoning":"private reasoning"},"finish_reason":null}]}\n\n';
  const a=adapter('groq',{key:'fixture',model:'openai/gpt-oss-20b',fetcher:async()=>response(reasoning+sse('Final answer.'))});let text='';const r=await a([],new AbortController().signal,d=>text+=d);assert.equal(text,'Final answer.');assert.equal(r.diagnostic.reasoningCharacters,17);
  const b=adapter('groq',{key:'fixture',fetcher:async()=>response(reasoning+'data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')});
  await assert.rejects(b([],new AbortController().signal),e=>{assert.equal(e.benchmarkDiagnostic.httpStatus,200);assert.equal(e.benchmarkDiagnostic.finishReason,'length');assert.equal(e.benchmarkDiagnostic.reasoningCharacters,17);assert.equal(e.benchmarkDiagnostic.contentCharacters,0);return true;});
});
test('HTTP errors retain only allowlisted Groq code, not sensitive body',async()=>{
  const a=adapter('groq',{key:'fixture',fetcher:async()=>new Response('{"error":{"code":"rate_limit_exceeded","message":"secret"}}',{status:429})});
  await assert.rejects(a([],new AbortController().signal),e=>{assert.equal(e.benchmarkDiagnostic.groqErrorCode,'rate_limit_exceeded');assert.equal(e.benchmarkDiagnostic.httpStatus,429);assert.ok(!JSON.stringify(e.benchmarkDiagnostic).includes('secret'));return true;});
});
test('parse failure and premature body reset are distinguished',async()=>{
  const a=adapter('groq',{key:'fixture',fetcher:async()=>response('data: invalid\n\n')});await assert.rejects(a([],new AbortController().signal),e=>e.benchmarkDiagnostic.phase==='parsing');
  const b=adapter('groq',{key:'fixture',fetcher:async()=>new Response(new ReadableStream({pull(c){c.error(Object.assign(Error('private'),{code:'ECONNRESET'}));}}),{headers:{'content-type':'text/event-stream'}})});
  await assert.rejects(b([],new AbortController().signal),e=>e.benchmarkDiagnostic.phase==='stream-body'&&e.benchmarkDiagnostic.networkCode==='ECONNRESET');
});
test('client deadline is explicitly separate from transport connect timeout',async()=>{
  const a=adapter('groq',{key:'fixture',timeoutMs:20,fetcher:async(_u,o)=>new Promise((_,reject)=>{const keepAlive=setTimeout(()=>reject(Error('fixture bound')),200);o.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(o.signal.reason);},{once:true});})});
  await assert.rejects(a([],new AbortController().signal),e=>e.benchmarkDiagnostic.clientDeadlineExpired===true&&e.benchmarkDiagnostic.timeoutStage==='before-headers'&&e.benchmarkDiagnostic.networkCode===null);
});
test('single-case diagnostic cannot fall through to the rest of the benchmark',async()=>{
  let n=0;const r=await run({approved:true,variants:['groq'],caseIds:['fact'],snapshot:async()=>idle(),providers:{groq:async(_m,_s,d)=>{n++;d('The demonstration guide covers catalog searches.');return {text:'The demonstration guide covers catalog searches.'};}}});assert.equal(n,1);assert.equal(r.rows.length,1);assert.equal(r.rows[0].id,'fact');
});
test('revised bounded allowance preserves messages and reports reasoning token counts',async()=>{
  const messages=cases().find(c=>c.id==='general').messages;
  const a=adapter('groq',{key:'fixture',model:'openai/gpt-oss-20b',maxCompletionTokens:256,fetcher:async(_u,o)=>{const b=JSON.parse(o.body);assert.equal(b.max_completion_tokens,256);assert.equal(b.reasoning_effort,'low');assert.deepEqual(b.messages,messages);return response(sse('Use a specific topic, then narrow by date.').replace('data: [DONE]','data: {"choices":[],"usage":{"completion_tokens_details":{"reasoning_tokens":24}}}\n\ndata: [DONE]'));}});
  const r=await a(messages,new AbortController().signal);assert.equal(r.usage.reasoning_tokens,24);assert.equal(r.terminal.finish_reason,'stop');
  for(const n of [0,513,Infinity,2.5])assert.throws(()=>adapter('groq',{key:'fixture',maxCompletionTokens:n}));
});
