const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function registry(rows){
 const m={exports:{}},queries=[];
 const connection={query:async()=>({rows:[]}),release(){}};
 const pool={connect:async()=>connection,query:async(sql,params)=>{queries.push({sql,params});return {rows};}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/local-voice-registry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n==='server-only'?{}:n==='./database'?{db:async()=>pool}:require(n),m,m.exports);
 return {...m.exports,queries};
}
const voice=id=>({id,name:id[0].toUpperCase()+id.slice(1),gender:'female',language:'English',accent:'English',selectable:true});
test('approved Emma and Olivia remain visible when only Lissa engine is online',async()=>{
 const r=registry(['lissa','emma','olivia'].map(voice));
 const result=await r.registeredVoices('owner',{defaultVoice:'lissa',voices:[voice('lissa')]});
 assert.deepEqual(result.voices.map(v=>v.id),['lissa','emma','olivia']);assert.equal(result.defaultVoice,'lissa');
 assert.equal(result.voices[0].serviceReady,true);assert.equal(result.voices[1].serviceReady,false);assert.equal(result.voices[2].serviceReady,false);
 assert.match(r.queries[0].sql,/status='ACTIVE'/);assert.match(r.queries[0].sql,/is_global=TRUE OR owner_id=\$1/);assert.deepEqual(r.queries[0].params,['owner']);
});
test('restored clone backend marks approved voices ready without exposing unrelated offline entries',async()=>{
 const r=registry(['lissa','emma','olivia','private-unprovisioned'].map(voice));
 const result=await r.registeredVoices('owner',{defaultVoice:'lissa',voices:['lissa','emma','olivia'].map(voice)});
 assert.deepEqual(result.voices.map(v=>v.id),['lissa','emma','olivia']);assert.ok(result.voices.every(v=>v.serviceReady));
});
