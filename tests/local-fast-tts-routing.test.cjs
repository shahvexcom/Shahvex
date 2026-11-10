const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('candidate TTS routing is explicitly local and never selected by Vercel',async()=>{
  const code=ts.transpileModule(fs.readFileSync('lib/agent-test.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='server-only'?{}:require(name),mod,mod.exports);
  const names=['SHAHVEX_PC_AI_URL','SHAHVEX_LOCAL_FAST_TTS','VERCEL'];const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));const original=global.fetch;let target;
  try{
    delete process.env.SHAHVEX_PC_AI_URL;delete process.env.VERCEL;delete process.env.SHAHVEX_LOCAL_FAST_TTS;
    global.fetch=async url=>{target=String(url);return Response.json({});};
    await mod.exports.engine(8767,'/health');assert.equal(target,'http://127.0.0.1:8767/health');
    process.env.SHAHVEX_LOCAL_FAST_TTS='1';await mod.exports.engine(8767,'/health');assert.equal(target,'http://127.0.0.1:8776/health');
    await mod.exports.engine(8766,'/transcribe');assert.equal(target,'http://127.0.0.1:8766/transcribe');
    process.env.SHAHVEX_LOCAL_FAST_TTS='kokoro';await mod.exports.engine(8767,'/health');assert.equal(target,'http://127.0.0.1:8778/health');
    process.env.VERCEL='1';await mod.exports.engine(8767,'/health');assert.equal(target,'http://127.0.0.1:8767/health');
  }finally{global.fetch=original;for(const n of names)if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}
});
