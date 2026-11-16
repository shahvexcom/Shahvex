const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
let registryOverride;
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='server-only'?{}:name==='./local-voice-registry'&&registryOverride?registryOverride:require(name),mod,mod.exports);

test('catalog exposes provisioned clones, hides Jenifer, and keeps clone routing',async()=>{
 const original=global.fetch,prior={...process.env},calls=[];
 process.env.SHAHVEX_FAST_VOICE='1';delete process.env.SHAHVEX_PC_AI_URL;delete process.env.SHAHVEX_LOCAL_FAST_TTS;
 global.fetch=async url=>{calls.push(String(url));if(String(url).endsWith('/voices'))return Response.json({voices:[...['lissa','emma','olivia'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),selectable:true})),{id:'af_heart',name:'Jenifer',selectable:true},{id:'jennifer',name:'Jennifer old',selectable:true}]});return new Response('audio');};
 try{
  const catalog=await(await mod.exports.engine(8767,'/voices')).json();
  assert.equal(catalog.default_voice,'lissa');assert.deepEqual(catalog.voices.map(v=>v.id),['lissa','emma','olivia']);
  assert.ok(!calls.some(url=>url.includes('8778')));
  assert.deepEqual((await mod.exports.localVoices()).voices.map(v=>v.name),['Lissa','Emma','Olivia']);
  for(const voice of ['lissa','emma','olivia'])for(const path of ['/synthesize','/stream']){
   await mod.exports.engine(8767,path,{method:'POST',body:new TextEncoder().encode(JSON.stringify({voice_id:voice,text:'Hello'}))});
   assert.equal(calls.at(-1),`http://127.0.0.1:${voice==='lissa'?8767:8780}`+path);
  }
  global.fetch=async()=>Response.json({voices:[{id:'lissa',name:'Lissa',selectable:true},{id:'emma',name:'Emma',selectable:false}]});
  assert.deepEqual((await mod.exports.localVoices()).voices.map(v=>v.id),['lissa']);
 }finally{global.fetch=original;for(const key of ['SHAHVEX_FAST_VOICE','SHAHVEX_PC_AI_URL','SHAHVEX_LOCAL_FAST_TTS']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
test('situational fillers fit useful answers and options and skip sensitive contexts',()=>{
 const h=[{role:'assistant',content:'Hello, this is Emma from Shahvex.'},{role:'user',content:'Go ahead.'},{role:'assistant',content:'What time are you usually free?'}];
 assert.match(mod.exports.situationalFillerHint(h,"I'm usually free in the evening."),/Mm-hmm/);
 assert.match(mod.exports.situationalFillerHint(h,'Which option would suit me?'),/Hmm/);
 for(const text of ['I am waiting.','I am worried.','Stop calling.','Hello.','Why do you need my age?','My father died.'])assert.equal(mod.exports.situationalFillerHint(h,text),'');
 assert.equal(mod.exports.situationalFillerHint(h.slice(0,1),'Hello.'),'');
 assert.equal(mod.exports.situationalFillerHint([...h,{role:'assistant',content:'Mm-hmm, what is your age?'}],'I am 65.'),'');
});

test('saved approved voices remain configurable offline with readiness explicitly false',async()=>{
 const original=global.fetch;
 registryOverride={savedVoiceCatalog:async owner=>{assert.equal(owner,'voice-owner');return {defaultVoice:'lissa',voices:[{id:'lissa',name:'Lissa'},{id:'emma',name:'Emma'},{id:'olivia',name:'Olivia'}]};}};
 global.fetch=async()=>{throw Error('offline');};
 try{const result=await mod.exports.localVoices('voice-owner');assert.equal(result.serviceReady,false);assert.equal(result.defaultVoice,'lissa');assert.deepEqual(result.voices.map(v=>v.id),['lissa','emma','olivia']);}
 finally{global.fetch=original;registryOverride=undefined;}
});

test('new clone warmups use their own cache and leave the Lissa engine route unchanged',async()=>{
 const original=global.fetch,remote=process.env.SHAHVEX_PC_AI_URL,fast=process.env.SHAHVEX_LOCAL_FAST_TTS,calls=[];
 delete process.env.SHAHVEX_PC_AI_URL;delete process.env.SHAHVEX_LOCAL_FAST_TTS;
 global.fetch=async url=>{calls.push(String(url));return Response.json({cached_voice_ids:String(url).includes('8780')?['emma','olivia']:['lissa']});};
 try{await mod.exports.warmSelectedVoice('emma');await mod.exports.warmSelectedVoice('olivia');await mod.exports.warmSelectedVoice('lissa');assert.deepEqual(calls,['http://127.0.0.1:8780/health','http://127.0.0.1:8780/health','http://127.0.0.1:8767/health']);}
 finally{global.fetch=original;if(remote===undefined)delete process.env.SHAHVEX_PC_AI_URL;else process.env.SHAHVEX_PC_AI_URL=remote;if(fast===undefined)delete process.env.SHAHVEX_LOCAL_FAST_TTS;else process.env.SHAHVEX_LOCAL_FAST_TTS=fast;}
});
