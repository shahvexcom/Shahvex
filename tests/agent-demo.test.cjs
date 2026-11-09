const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};new Function('require','module','exports',code)(n=>Object.hasOwn(deps,n)?deps[n]:require(n),mod,mod.exports);return mod.exports;
}
const envNames=['VERCEL','SHAHVEX_DEMO_BACKEND_URL','SHAHVEX_DEMO_BRIDGE_SECRET','SHAHVEX_CF_ACCESS_CLIENT_ID','SHAHVEX_CF_ACCESS_CLIENT_SECRET'];
const saved=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;for(const n of envNames){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}});
const service=load('lib/agent-test.ts',{'server-only':{}});
const token='a'.repeat(43), origin='https://www.shahvex.com';
const ctx={params:Promise.resolve({token})};
const request=(action,body={},id='session')=>new Request(`${origin}/api/demo/agent/${token}?action=${action}&id=${id}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
function harness(overrides={}) {
  for(const n of envNames)delete process.env[n];
  const link={id:'link',agent_id:'agent',owner_id:'owner',name:'Assigned',avatar_url:'',local_voice_id:'saved-voice',speaks_first:'ai',script:'Private script and knowledge',accent:'British',language:'English',conversation_style:'Friendly',expires_at:new Date(Date.now()+3600000),max_sessions:5,used_sessions:0};
  const calls=[];const pool={connect:async()=>({...pool,release(){}}),query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('SELECT * FROM agent_demo_links'))return {rows:[link],rowCount:1};
    if(sql.includes('COUNT(*)'))return {rows:[{n:0}],rowCount:1};
    return {rows:[{id:'session'}],rowCount:1};
  }};
  const demo={demoDb:async()=>pool,demoHeaders:{'Cache-Control':'no-store'},demoJson:(d,s=200)=>Response.json(d,{status:s}),demoLink:async()=>link,demoRate:async()=>true,...overrides};
  const route=load('app/api/demo/agent/[token]/route.ts',{'@/lib/agent-demo':demo,'@/lib/agent-test':{...service,localVoices:async()=>({voices:[{id:'saved-voice'}]}),warmSelectedVoice:async()=>{}},'@/lib/agent-script-extraction':{extractAgentScript:async()=>({goals:['Saved goal'],tasks:[],instructions:['Saved instruction'],conversationFlow:[],restrictions:[],knowledge:['Saved fact'],faqs:[]})},'@/lib/agent-test-session':{handleTestSession:async()=>Response.json({ok:true})}});
  return {route,link,calls,pool};
}
test('tokens contain 256 bits of randomness, validate strictly, and are hashed for storage',async()=>{
  const demo=load('lib/agent-demo.ts',{'server-only':{},'./database':{db:async()=>{throw Error('No DB expected');}}});
  const tokens=new Set(Array.from({length:1000},()=>demo.demoToken()));assert.equal(tokens.size,1000);
  for(const t of tokens){assert.equal(demo.validDemoToken(t),true);assert.equal(demo.demoHash(t).length,64);assert.notEqual(demo.demoHash(t),t);}
  assert.equal(demo.validDemoToken('../secret'),false);assert.equal(await demo.demoLink('../secret'),null);
});
test('public metadata excludes saved script, knowledge, owner and real voice id',async()=>{
  const {route}=harness();const r=await route.GET(new Request(origin),ctx);assert.equal(r.status,200);const body=await r.text();
  for(const secret of ['Private script','saved-voice','owner_id','Saved fact'])assert.ok(!body.includes(secret));
});
test('invalid, revoked, expired or foreign-owner links fail closed before session dispatch',async()=>{
  const {route}=harness({demoLink:async()=>null});assert.equal((await route.GET(new Request(origin),ctx)).status,404);assert.equal((await route.POST(request('turn'),ctx)).status,404);
});
test('consent, origin and public action restrictions are enforced',async()=>{
  const {route,calls}=harness();assert.equal((await route.POST(request('start',{consent:false}),ctx)).status,400);
  assert.equal(calls.length,0);assert.equal((await route.POST(request('extract'),ctx)).status,400);
  const r=request('start',{consent:true});r.headers.set('origin','https://evil.example');assert.equal((await route.POST(r,ctx)).status,403);
});
test('start ignores client configuration and loads saved script, voice, goals, accent and instructions',async()=>{
  const {route,calls}=harness();const r=await route.POST(request('start',{consent:true,agentId:'foreign',config:{script:'attacker',voice:'attacker'}}),ctx);
  assert.equal(r.status,200);const {id}=await r.json();const session=service.sessions.get(id);assert.equal(session.agentId,'agent');assert.equal(session.config.voice,'saved-voice');
  for(const text of ['Private script','Saved goal','Saved instruction','Saved fact','British'])assert.ok(session.messages[0].content.includes(text));
  assert.ok(!session.messages[0].content.includes('attacker'));assert.ok(calls.some(c=>c.sql.includes('consent_version')));assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));service.sessions.delete(id);
});
test('exhausted links and global demo capacity reject session allocation',async()=>{
  const a=harness();a.link.used_sessions=5;assert.equal((await a.route.POST(request('start',{consent:true}),ctx)).status,410);
  const b=harness();const query=b.pool.query;b.pool.query=async(sql,args)=>sql.includes('COUNT(*)')?{rows:[{n:1}],rowCount:1}:query(sql,args);
  assert.equal((await b.route.POST(request('start',{consent:true}),ctx)).status,429);
});
test('session ids from another agent cannot be used with a demo link',async()=>{
  const {route}=harness();const id=service.newTest('other','foreign',{name:'Other',voice:'v',first:'ai',goal:'',task:'',instructions:'',script:'',knowledge:'',style:''});
  assert.equal((await route.POST(request('turn',{},id),ctx)).status,410);service.sessions.delete(id);
});
test('shared rate limit rejects requests before model work',async()=>{
  const {route}=harness({demoRate:async()=>false});assert.equal((await route.POST(request('start',{consent:true}),ctx)).status,429);
});
test('Vercel refuses loopback fallback and forwards only server credentials to authenticated HTTPS backend',async()=>{
  const {route}=harness();process.env.VERCEL='1';assert.equal((await route.GET(new Request(origin),ctx)).status,503);
  process.env.SHAHVEX_DEMO_BACKEND_URL='http://127.0.0.1:3000';assert.equal((await route.GET(new Request(origin),ctx)).status,503);
  process.env.SHAHVEX_DEMO_BACKEND_URL='https://demo-engine.shahvex.com';process.env.SHAHVEX_DEMO_BRIDGE_SECRET='bridge-secret';process.env.SHAHVEX_CF_ACCESS_CLIENT_ID='client';process.env.SHAHVEX_CF_ACCESS_CLIENT_SECRET='cf-secret';
  global.fetch=async(url,init)=>{assert.equal(url.hostname,'demo-engine.shahvex.com');assert.equal(init.headers.get('x-shahvex-demo-key'),'bridge-secret');assert.equal(init.headers.get('CF-Access-Client-Secret'),'cf-secret');assert.equal(init.headers.get('cookie'),null);assert.equal(init.headers.get('origin'),'https://demo-engine.shahvex.com');return Response.json({safe:true});};
  const r=await route.POST(request('turn'),ctx);assert.equal(r.status,200);assert.deepEqual(await r.json(),{safe:true});assert.equal(r.headers.get('x-shahvex-demo-key'),null);
});
test('persistent backend requires the configured bridge secret',async()=>{
  const {route}=harness();process.env.SHAHVEX_DEMO_BRIDGE_SECRET='private';assert.equal((await route.GET(new Request(origin),ctx)).status,401);
  assert.equal((await route.POST(request('extract'),ctx)).status,401);
  const behindTunnel=new Request(`http://127.0.0.1:3000/api/demo/agent/${token}?action=extract`,{method:'POST',headers:{origin,'x-shahvex-demo-key':'private'},body:'{}'});
  assert.equal((await route.POST(behindTunnel,ctx)).status,400);
});
test('admin link generation requires authenticated ownership and rejects foreign origins',async()=>{
  let role='AGENT';const route=load('app/api/admin/agent-demo-links/route.ts',{
    'next/headers':{cookies:async()=>({get:()=>({value:'session'})})},'@/lib/session':{ADMIN_SESSION_COOKIE:'admin',readSession:async()=>({role,agentId:'owner'})},
    '@/lib/agent-demo':{demoJson:(d,s=200)=>Response.json(d,{status:s}),demoDb:async()=>({connect:async()=>({query:async()=>({rows:[],rowCount:0}),release(){}})})}
  });
  assert.equal((await route.GET()).status,401);role='ADMIN';const r=request('');r.headers.set('origin','https://evil.example');assert.equal((await route.POST(r)).status,403);
  assert.equal((await route.POST(request('',{action:'generate',agentId:'foreign'}))).status,403);
});
