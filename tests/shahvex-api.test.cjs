const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
function load(file,deps={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const m={exports:{}};new Function('require','module','exports',code)(n=>n==='server-only'?{}:Object.hasOwn(deps,n)?deps[n]:require(n),m,m.exports);return m.exports;}
const names=['SHAHVEX_API_URL','SHAHVEX_CF_CLIENT_ID','SHAHVEX_CF_CLIENT_SECRET'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
afterEach(()=>{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}});
const configure=()=>{process.env.SHAHVEX_API_URL='https://ai.shahvex.com';process.env.SHAHVEX_CF_CLIENT_ID='private-client';process.env.SHAHVEX_CF_CLIENT_SECRET='private-secret';};
function client(status=200,content='{}',headers={}){
  const calls=[];const api=load('lib/shahvex-api.ts',{'node:https':{request:(url,options,callback)=>{
    calls.push({url,options});const r=new EventEmitter();r.end=body=>{calls.at(-1).body=body;queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers={'content-type':'application/json',...headers};callback(response);response.end(content);});};return r;
  }}});return {api,calls};
}
test('API client sends Cloudflare headers only to fixed HTTPS operations and strips upstream secrets',async()=>{
  configure();const {api,calls}=client(200,'{"status":"ready"}',{'cf-access-client-secret':'must-not-leak','set-cookie':'private'});
  const r=await api.shahvexApi('/health');assert.equal((await r.json()).status,'ready');assert.equal(calls[0].url.origin,'https://ai.shahvex.com');assert.equal(calls[0].options.headers['CF-Access-Client-Secret'],'private-secret');assert.equal(calls[0].options.headers['Cache-Control'],'no-store');assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cf-access-client-secret'),null);
  for(const path of ['https://evil.example','/../health','/sessions/../secret','/conversation?url=evil','/conversation/phrases'])await assert.rejects(api.shahvexApi(path));
  process.env.SHAHVEX_API_URL='http://127.0.0.1:8768';await assert.rejects(api.shahvexApi('/health'));assert.equal(calls.length,1);
});
test('Cloudflare denial, model errors and redirects are safe errors without upstream body content',async()=>{
  configure();for(const status of [401,403,500,502,503,302]){const {api}=client(status,'private-script-private-secret');await assert.rejects(api.shahvexApi('/health'),e=>{assert.ok(!e.message.includes('private'));assert.ok([502,503].includes(e.status));return true;});}
});
test('network failure and caller cancellation do not echo credentials or network internals',async()=>{
  configure();const api=load('lib/shahvex-api.ts',{'node:https':{request:(_url,options)=>{const r=new EventEmitter();r.end=()=>{options.signal.addEventListener('abort',()=>r.emit('error',Error('private-secret')),{once:true});};return r;}}});const control=new AbortController();const p=api.shahvexApi('/health',{signal:control.signal});control.abort();await assert.rejects(p,e=>e.status===504&&!e.message.includes('private'));
});
const api=load('lib/shahvex-api.ts');
const audio=load('lib/agent-test-audio.ts');
const sessionId='11111111-1111-4111-8111-111111111111',upstreamId='a'.repeat(32);
function harness(overrides={}){
  const calls=[];const principal={agentId:'owner',role:'ADMIN'};
  const row={id:sessionId,owner_id:'owner',agent_id:'agent',upstream_id:null,upstream_agent_id:'physical-agent'};
  const agent={id:'agent',name:'Agent',local_voice_id:'voice'};
  const pool={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[{id:sessionId}]};},connect:async()=>({...pool,release(){}})};
  const access={shahvexPrincipal:async()=>principal,shahvexRate:async()=>{},sameOrigin:r=>{if(r.headers.get('origin')!==new URL(r.url).origin)throw new api.ShahvexError(403,'Same-origin request required');},boundedRequest:async(r,max)=>{const b=Buffer.from(await r.arrayBuffer());if(b.length>max)throw new api.ShahvexError(413,'Too large');return b;},shahvexAgent:async()=>agent,createShahvexSession:async()=>sessionId,ownedShahvexSession:async()=>({row,agent}),shahvexDb:async()=>pool,...overrides.access};
  const upstream=overrides.upstream||(async(path,options)=>{calls.push({path,options});return new Response(new Uint8Array([1,2,3,4]),{headers:{'content-type':'application/octet-stream','x-session-id':upstreamId,'x-agent-id':'physical-agent','x-voice-id':'voice','x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});
  const routes=load('lib/shahvex-routes.ts',{'./shahvex-access':access,'./shahvex-api':{...api,shahvexApi:upstream},'./agent-test-audio':audio});return {routes,calls,row,agent};
}
function req(extra={}){const samples=Int16Array.from({length:16000},(_,i)=>Math.round(Math.sin(i*.17)*3000));const f=new FormData();f.append('audio',audio.speechWav([samples]),'speech.wav');f.append('agentId','agent');f.append('sessionId',sessionId);f.append('turnId','turn-1');for(const [k,v]of Object.entries(extra))f.append(k,v);return new Request('https://www.shahvex.com/api/shahvex/conversation/stream',{method:'POST',headers:{origin:'https://www.shahvex.com'},body:f});}
test('conversation uses only real multipart fields, server agent binding, opaque local session IDs and raw PCM',async()=>{
  const {routes,calls}=harness();const r=await routes.shahvexConversation(req(),true);assert.equal(r.status,200);assert.equal(r.headers.get('x-session-id'),sessionId);assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3,4]);const sent=calls.find(c=>c.path);assert.equal(sent.path,'/conversation/stream');assert.deepEqual([...sent.options.form.keys()],['audio','agent_id','voice_id','agent_name']);assert.equal(sent.options.form.get('agent_id'),'physical-agent');assert.ok(calls.some(c=>c.sql?.includes('shahvex_turns')));assert.ok(calls.some(c=>c.sql?.includes('busy_until=NULL')));
});
test('authentication, agent authorization, session ownership and foreign session-agent pairing fail before inference',async()=>{
  for(const method of ['shahvexPrincipal','shahvexAgent','ownedShahvexSession']){let upstream=false;const {routes}=harness({access:{[method]:async()=>{throw new api.ShahvexError(method==='shahvexPrincipal'?401:403,'Denied');}},upstream:async()=>{upstream=true;}});assert.ok([401,403].includes((await routes.shahvexConversation(req(),true)).status));assert.equal(upstream,false);}
  const h=harness();h.row.agent_id='foreign';assert.equal((await h.routes.shahvexConversation(req(),true)).status,403);
});
test('text, arbitrary fields, unconfirmed audio and foreign origins are rejected',async()=>{
  const {routes}=harness();assert.equal((await routes.shahvexConversation(req({script:'override'}),true)).status,400);
  const text=new Request('https://www.shahvex.com/api/shahvex/conversation',{method:'POST',headers:{origin:'https://www.shahvex.com','content-type':'application/json'},body:'{"text":"hello"}'});assert.equal((await routes.shahvexConversation(text,false)).status,415);
  const foreign=req();foreign.headers.set('origin','https://evil.example');assert.equal((await routes.shahvexConversation(foreign,true)).status,403);
});
test('PCM is returned incrementally and cancellation reaches upstream reader and releases admission',async()=>{
  let send,cancelled=false;const h=harness({upstream:async()=>new Response(new ReadableStream({start(c){send=c;c.enqueue(new Uint8Array([1,2]));},cancel(){cancelled=true;}}),{headers:{'x-session-id':upstreamId,'x-agent-id':'physical-agent','x-voice-id':'voice','x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
  const r=await h.routes.shahvexConversation(req(),true);const reader=r.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2]);await reader.cancel();assert.equal(cancelled,true);assert.ok(h.calls.some(c=>c.sql?.includes('busy_until=NULL')));
});
test('health and session metadata exclude scripts, transcript content, tokens and upstream IDs',async()=>{
  const h=harness({upstream:async(path)=>Response.json(path==='/health'?{status:'ready',streaming:true,multi_turn_memory:true,private:'secret'}:{session_id:upstreamId,agent_id:'physical-agent',voice_id:'voice',turn_count:2,history_messages:4,busy:false,private:'secret'})});h.row.upstream_id=upstreamId;
  const request=new Request('https://www.shahvex.com/api/shahvex/health');for(const r of [await h.routes.shahvexHealth(request),await h.routes.shahvexSession(request,sessionId)]){assert.equal(r.status,200);const b=await r.text();assert.ok(!b.includes('secret'));assert.ok(!b.includes(upstreamId));}
});
test('saved configuration hashes change when script, voice or speaking behavior changes',()=>{
  const access=load('lib/shahvex-access.ts',{'next/headers':{},'./database':{},'./session':{},'./shahvex-api':api});const a={id:'a',name:'A',local_voice_id:'v',script:'private',speaks_first:'customer'};for(const key of ['script','local_voice_id','speaks_first'])assert.notEqual(access.agentConfigHash(a),access.agentConfigHash({...a,[key]:'changed'}));
});
