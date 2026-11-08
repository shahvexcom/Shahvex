const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
test('microphone worklet emits exact PCM16 20ms frames across input blocks', () => {
  let Processor; const frames=[];
  vm.runInNewContext(fs.readFileSync('public/shahvex-microphone-worklet.js','utf8'), {
    AudioWorkletProcessor: class { constructor(){ this.port={postMessage: buffer => frames.push(buffer)}; } },
    registerProcessor: (_name, implementation) => { Processor=implementation; },
    Int16Array, Math,
  });
  const worklet=new Processor();
  for(let i=0;i<5;i++) worklet.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(frames.length,2); assert.equal(frames[0].byteLength,640);
  assert.equal(new Int16Array(frames[0])[0],16384);
});
function load(role, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/local-voice/route.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  const deps = { 'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture' }) }) }, '@/lib/session': { readSession: async () => ({ role, agentId: 'owner' }) }, '@/lib/local-voice-relay': { relays: new Map() }, '@/app/api/admin/agents/gateway-export/route': {} };
  Object.assign(deps,dependencies);
  if(!deps['@/lib/local-voice-relay'].voiceMaintenance)deps['@/lib/local-voice-relay'].voiceMaintenance=()=>({maintenance:false,activeRelays:0,startingRelays:0});
  new Function('require','module','exports',code)(n => n.endsWith('/gateway/test-script.cjs') ? require('../gateway/test-script.cjs') : deps[n], mod, mod.exports); return mod.exports;
}
test('browser relay fails closed without opt-in, outside localhost, across origins and for non-admins', async () => {
  const old = process.env.SHAHVEX_LOCAL_VOICE_TEST;
  const oldMode=process.env.NODE_ENV;process.env.NODE_ENV='development';
  try {
    delete process.env.SHAHVEX_LOCAL_VOICE_TEST;
    assert.equal((await load('ADMIN').POST(new Request('http://localhost:3000/api/admin/local-voice', { method:'POST',headers:{origin:'http://localhost:3000'} }))).status,403);
    process.env.SHAHVEX_LOCAL_VOICE_TEST='1';
    for (const [url, origin] of [['http://example.com','http://example.com'],['http://localhost:3000','http://evil.example']])
      assert.equal((await load('ADMIN').POST(new Request(`${url}/api/admin/local-voice`,{method:'POST',headers:{origin}}))).status,403);
    assert.equal((await load('BPO').POST(new Request('http://localhost:3000/api/admin/local-voice',{method:'POST',headers:{origin:'http://localhost:3000'}}))).status,401);
    assert.equal((await load('ADMIN').POST(new Request('http://localhost:3000/api/admin/local-voice?id=other',{method:'POST',headers:{origin:'http://localhost:3000'}}))).status,404);
    assert.equal((await load('ADMIN').POST(new Request('http://localhost:3000/api/admin/local-voice?id=already-closed&stop=1',{method:'POST',headers:{origin:'http://localhost:3000'}}))).status,200);
  } finally { if(old===undefined) delete process.env.SHAHVEX_LOCAL_VOICE_TEST; else process.env.SHAHVEX_LOCAL_VOICE_TEST=old; if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode; }
});
test('local authorized creation uses approved export; hosted environments and invalid credentials fail closed', async()=>{
  const keys=['SHAHVEX_LOCAL_VOICE_TEST','NODE_ENV','SHAHVEX_GATEWAY_URL','SHAHVEX_GATEWAY_TOKEN','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const request=()=>new Request('http://127.0.0.1:3000/api/admin/local-voice?agentId=jennifer',{method:'POST',headers:{origin:'http://127.0.0.1:3000'}});
  try{
    keys.forEach(k=>delete process.env[k]);Object.assign(process.env,{NODE_ENV:'development',SHAHVEX_LOCAL_VOICE_TEST:'1',SHAHVEX_GATEWAY_URL:'http://127.0.0.1:8787',SHAHVEX_GATEWAY_TOKEN:'fixture'.repeat(8)});
    let creates=0;
    const deps={'@/lib/local-voice-relay':{relays:new Map(),createRelay:async(owner,config)=>{assert.equal(owner,'owner');assert.equal(config.agentName,'Jennifer');creates++;return 'opaque-handle';}},'@/app/api/admin/agents/gateway-export/route':{GET:async()=>Response.json({agentName:'Jennifer',script:'Approved script'})}};
    const response=await load('ADMIN',deps).POST(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:'opaque-handle',scriptMode:'assigned'});
    for(const key of ['VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID']){process.env[key]='fixture';assert.equal((await load('ADMIN',deps).POST(request())).status,403);delete process.env[key];}
    process.env.NODE_ENV='production';assert.equal((await load('ADMIN',deps).POST(request())).status,403);process.env.NODE_ENV='development';
    process.env.SHAHVEX_GATEWAY_TOKEN='short';assert.equal((await load('ADMIN',deps).POST(request())).status,503);
    assert.equal(creates,1);
    process.env.SHAHVEX_GATEWAY_TOKEN='fixture'.repeat(8);
    const custom=await load('ADMIN',deps).POST(new Request('http://127.0.0.1:3000/api/admin/local-voice?agentId=jennifer',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body:JSON.stringify({customScript:'Use a calm test persona.'})}));assert.equal(custom.status,200);assert.equal((await custom.json()).scriptMode,'custom');
    const invalid=await load('ADMIN',deps).POST(new Request('http://127.0.0.1:3000/api/admin/local-voice?agentId=jennifer',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body:JSON.stringify({customScript:'x'.repeat(16001)})}));assert.equal(invalid.status,400);
    deps['@/app/api/admin/agents/gateway-export/route'].GET=async()=>Response.json({error:'not approved'},{status:404});assert.equal((await load('ADMIN',deps).POST(request())).status,404);
  }finally{keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
test('authenticated availability diagnoses actual server env with booleans only and precise missing opt-in',async()=>{
  const keys=['SHAHVEX_LOCAL_VOICE_TEST','NODE_ENV','SHAHVEX_GATEWAY_URL','SHAHVEX_GATEWAY_TOKEN','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const req=()=>new Request('http://127.0.0.1:3000/api/admin/local-voice?status=1',{headers:{'sec-fetch-site':'same-origin'}});
  try{
    keys.forEach(k=>delete process.env[k]);process.env.NODE_ENV='development';
    let r=await load('ADMIN').GET(req());let d=await r.json();
    assert.equal(r.status,200);assert.equal(d.checks.optedIn,false);assert.equal(d.checks.gatewayTokenPresent,false);assert.match(d.reasons[0],/does not have SHAHVEX_LOCAL_VOICE_TEST=1/);
    assert.equal((await load('BPO').GET(req())).status,401);
    Object.assign(process.env,{SHAHVEX_LOCAL_VOICE_TEST:'1',SHAHVEX_GATEWAY_URL:'http://127.0.0.1:8787',SHAHVEX_GATEWAY_TOKEN:'private-fixture-never-echo-'.repeat(3)});
    r=await load('ADMIN').GET(req());d=await r.json();assert.equal(d.enabled,true);assert.equal(d.configured,true);assert.equal(d.reasons.length,0);assert.ok(!JSON.stringify(d).includes(process.env.SHAHVEX_GATEWAY_TOKEN));assert.ok(!JSON.stringify(d).includes('http://127.0.0.1:8787'));
    process.env.VERCEL='1';d=await(await load('ADMIN').GET(req())).json();assert.equal(d.enabled,false);assert.match(d.reasons[0],/Vercel or Railway/);
  }finally{keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
test('direct Host preserves browser origin when Next reconstructs localhost; aliases and cross-site remain forbidden',async()=>{
  const keys=['NODE_ENV','SHAHVEX_LOCAL_VOICE_TEST','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    keys.forEach(k=>delete process.env[k]);process.env.NODE_ENV='development';process.env.SHAHVEX_LOCAL_VOICE_TEST='1';
    const make=(origin,host='127.0.0.1:3000',site='same-origin')=>new Request('http://localhost:3000/api/admin/local-voice?id=unknown',{method:'POST',headers:{host,origin,'sec-fetch-site':site}});
    // Reaches scoped-session authorization, not the origin rejection.
    assert.equal((await load('ADMIN').POST(make('http://127.0.0.1:3000'))).status,404);
    assert.equal((await load('BPO').POST(make('http://127.0.0.1:3000'))).status,401);
    for(const origin of ['http://localhost:3000','http://127.0.0.1:3001','https://127.0.0.1:3000','null','http://evil.example'])
      assert.equal((await load('ADMIN').POST(make(origin))).status,403);
    assert.equal((await load('ADMIN').POST(make('http://evil.example','evil.example'))).status,403);
    assert.equal((await load('ADMIN').POST(make('http://127.0.0.1:3000','127.0.0.1:3000','cross-site'))).status,403);
    const status=await load('ADMIN').GET(new Request('http://localhost:3000/api/admin/local-voice?status=1',{headers:{host:'127.0.0.1:3000','sec-fetch-site':'same-origin'}}));
    assert.equal((await status.json()).checks.sameOrigin,true);
  }finally{keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
test('Next.js health uses its server credential only and never forwards Gateway secrets/error bodies',async()=>{
  const keys=['NODE_ENV','SHAHVEX_LOCAL_VOICE_TEST','SHAHVEX_GATEWAY_URL','SHAHVEX_GATEWAY_TOKEN','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const priorFetch=global.fetch;
  const req=()=>new Request('http://127.0.0.1:3000/api/admin/local-voice?gatewayHealth=1',{headers:{'sec-fetch-site':'same-origin'}});
  try{
    keys.forEach(k=>delete process.env[k]);Object.assign(process.env,{NODE_ENV:'development',SHAHVEX_LOCAL_VOICE_TEST:'1',SHAHVEX_GATEWAY_URL:'http://127.0.0.1:8787',SHAHVEX_GATEWAY_TOKEN:'private-next-token-'.repeat(3)});
    let calls=0;
    global.fetch=async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,`Bearer ${process.env.SHAHVEX_GATEWAY_TOKEN}`);return Response.json({ready:true,activeSessions:0,queue:{active:0,pending:0},secret:'never forward'});};
    let response=await load('ADMIN').GET(req());let data=await response.json();assert.equal(response.status,200);assert.equal(data.authenticated,true);assert.equal(data.activeSessions,0);assert.ok(!JSON.stringify(data).includes('private-next-token'));assert.ok(!JSON.stringify(data).includes('never forward'));
    assert.equal((await load('BPO').GET(req())).status,401);assert.equal(calls,1);
    global.fetch=async()=>new Response('private failure response',{status:401});response=await load('ADMIN').GET(req());data=await response.json();assert.equal(response.status,502);assert.equal(data.gatewayStatus,401);assert.equal(data.authenticated,false);assert.ok(!JSON.stringify(data).includes('private failure'));
  }finally{global.fetch=priorFetch;keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
test('local admin maintenance blocks new sessions while keeping explicit stop authorized',async()=>{
  const keys=['NODE_ENV','SHAHVEX_LOCAL_VOICE_TEST','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    keys.forEach(k=>delete process.env[k]);process.env.NODE_ENV='development';process.env.SHAHVEX_LOCAL_VOICE_TEST='1';let maintenance=false;
    const deps={'@/lib/local-voice-relay':{relays:new Map(),voiceMaintenance:setting=>{if(setting!==undefined)maintenance=setting;return {maintenance,activeRelays:0,startingRelays:0};},createRelay:()=>{throw Error('Must not create while maintained');}}};
    const req=query=>new Request(`http://127.0.0.1:3000/api/admin/local-voice?${query}`,{method:'POST',headers:{origin:'http://127.0.0.1:3000'}});
    assert.equal((await load('BPO',deps).POST(req('maintenance=1'))).status,401);assert.equal(maintenance,false);
    assert.equal((await load('ADMIN',deps).POST(req('maintenance=1'))).status,200);assert.equal(maintenance,true);
    assert.equal((await load('ADMIN',deps).POST(req('agentId=jennifer'))).status,503);
    assert.equal((await load('ADMIN',deps).POST(req('id=closed&stop=1'))).status,200);
  }finally{keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
test('admin proof issuance enables maintenance, uses server-fetched health and ignores client proof fields',async()=>{
  const keys=['NODE_ENV','SHAHVEX_LOCAL_VOICE_TEST','SHAHVEX_GATEWAY_URL','SHAHVEX_GATEWAY_TOKEN','VERCEL','RAILWAY_ENVIRONMENT','RAILWAY_ENVIRONMENT_ID','RAILWAY_PROJECT_ID'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const previous=global.fetch;
  try{
    keys.forEach(k=>delete process.env[k]);Object.assign(process.env,{NODE_ENV:'development',SHAHVEX_LOCAL_VOICE_TEST:'1',SHAHVEX_GATEWAY_URL:'http://127.0.0.1:8787',SHAHVEX_GATEWAY_TOKEN:'server-only-fixture-'.repeat(3)});
    let maintenance=false,issued=0,locked=false;
    const deps={'@/lib/local-voice-relay':{relays:new Map(),voiceMaintenance:v=>{if(v!==undefined)maintenance=v;return{maintenance,activeRelays:0,startingRelays:0};},lockDeploymentMaintenance:()=>{locked=true;}},'@/lib/issue-local-idle-proof':{issueLocalIdleProof:async snapshot=>{issued++;assert.equal(snapshot.authenticated,true);assert.equal(snapshot.maintenance,true);assert.equal(snapshot.activeSessions,0);assert.equal(snapshot.issuedAtMs,undefined);return{issued:true};}}};
    global.fetch=async()=>Response.json({ready:true,activeSessions:0,queue:{active:0,pending:0}});
    const request=()=>new Request('http://127.0.0.1:3000/api/admin/local-voice?deploymentProof=1',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body:JSON.stringify({issuedAtMs:99999999999999,authenticated:true})});
    assert.equal((await load('BPO',deps).POST(request())).status,401);assert.equal(maintenance,false);
    assert.equal((await load('ADMIN',deps).POST(request())).status,200);assert.equal(issued,1);assert.equal(locked,true);
    global.fetch=async()=>Response.json({ready:true,activeSessions:1,queue:{active:0,pending:0}});assert.equal((await load('ADMIN',deps).POST(request())).status,409);assert.equal(issued,1);
    global.fetch=async()=>new Response(null,{status:401});assert.equal((await load('ADMIN',deps).POST(request())).status,409);assert.equal(issued,1);
  }finally{global.fetch=previous;keys.forEach(k=>{if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});}
});
