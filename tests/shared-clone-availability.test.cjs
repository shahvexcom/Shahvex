const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function route({ session = { agentId: 'bpo-owner' }, offline = false, ready = true } = {}) {
 const calls = [];
 const mod = { exports: {} };
 const deps = {
  '@/lib/database': { db: async () => ({ query: async () => ({ rows: [{ id: 'provider-profile', name: 'Provider profile', status: 'ACTIVE' }] }) }) },
  '@/lib/bpo-session': { requireApprovedBpo: async () => session },
  '@/lib/agent-test': { localVoices: async owner => { calls.push(owner); if (offline) throw Error('offline'); return { serviceReady:ready, voices: ['lissa', 'emma', 'olivia'].map(id => ({ id, name: id[0].toUpperCase()+id.slice(1), gender: 'female', language: 'English', selectable: true })) }; } },
 };
 const code = ts.transpileModule(fs.readFileSync('app/api/bpo/voices/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 new Function('require','module','exports',code)(name => deps[name] || require(name),mod,mod.exports);
 return { ...mod.exports, calls };
}
test('BPO voice library exposes all three shared clones using the authenticated owner',async()=>{
 const api=route(), response=await api.GET(), result=await response.json();
 assert.equal(response.status,200);
 assert.deepEqual(api.calls,['bpo-owner']);
 assert.deepEqual(result.voices.map(v=>v.name),['Provider profile','Lissa','Emma','Olivia']);
 for(const voice of result.voices.filter(v=>v.is_local)){assert.equal(voice.is_active,true);assert.equal(voice.status,'ACTIVE');}
 assert.equal(result.localVoiceError,null);
});
test('offline cloning service preserves existing profiles and returns an availability message',async()=>{
 const result=await(await route({offline:true}).GET()).json();
 assert.deepEqual(result.voices.map(v=>v.id),['provider-profile']);
 assert.match(result.localVoiceError,/temporarily unavailable/);
});
test('unauthenticated requests do not load the voice catalog',async()=>{
 const api=route({session:null});assert.equal((await api.GET()).status,401);assert.deepEqual(api.calls,[]);
});

test('registered shared voices remain visible with an offline-service notice',async()=>{
 const result=await(await route({ready:false}).GET()).json();
 assert.deepEqual(result.voices.filter(v=>v.is_local).map(v=>v.id),['lissa','emma','olivia']);
 assert.match(result.localVoiceError,/temporarily unavailable/);
});
