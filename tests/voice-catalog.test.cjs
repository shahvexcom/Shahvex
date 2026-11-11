const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='server-only'?{}:require(name),mod,mod.exports);

test('fast voice catalog includes provisioned clones and synthesis retains their actual engine',async()=>{
  const original=global.fetch,prior={...process.env},calls=[];
  process.env.SHAHVEX_FAST_VOICE='1';delete process.env.SHAHVEX_PC_AI_URL;delete process.env.SHAHVEX_LOCAL_FAST_TTS;
  global.fetch=async(url,init)=>{calls.push(String(url));if(String(url).endsWith('/voices'))return Response.json({voices:String(url).includes('8778')?[{id:'af_heart',selectable:true},{id:'unapproved-fast',selectable:true}]:[{id:'lissa',name:'Lissa',selectable:true},{id:'female_02',name:'Lauren',selectable:true},{id:'jennifer',name:'Jennifer old',selectable:true}]});return new Response('audio');};
  try{
    const catalog=await(await mod.exports.engine(8767,'/voices')).json();
    assert.equal(catalog.default_voice,'af_heart');assert.deepEqual(catalog.voices.map(v=>v.id),['af_heart','lissa']);
    const visible=await mod.exports.localVoices();
    assert.deepEqual(visible.voices.map(v=>v.name),['Jenifer','Lissa']);
    await mod.exports.engine(8767,'/synthesize',{method:'POST',body:JSON.stringify({voice_id:'lissa',text:'Hello'})});
    assert.equal(calls.at(-1),'http://127.0.0.1:8767/synthesize');
    await mod.exports.engine(8767,'/stream',{method:'POST',body:new TextEncoder().encode(JSON.stringify({voice_id:'af_heart',text:'Hello'}))});
    assert.equal(calls.at(-1),'http://127.0.0.1:8778/stream');
    global.fetch=async url=>{if(String(url).includes('8767'))throw Error('offline');return Response.json({voices:[{id:'af_heart',selectable:true}]});};
    assert.deepEqual((await(await mod.exports.engine(8767,'/voices')).json()).voices.map(v=>v.id),['af_heart']);
  }finally{global.fetch=original;for(const key of ['SHAHVEX_FAST_VOICE','SHAHVEX_PC_AI_URL','SHAHVEX_LOCAL_FAST_TTS']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
