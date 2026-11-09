const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('lib/pc-ai-engine.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod = {exports:{}};
new Function('require','module','exports',code)(name => name === 'server-only' ? {} : require(name),mod,mod.exports);
test('PC transport restricts destinations and operations and strips caller credentials',async()=>{
  const names=['SHAHVEX_PC_AI_URL','SHAHVEX_PC_AI_SECRET','SHAHVEX_CF_CLIENT_ID','SHAHVEX_CF_CLIENT_SECRET'];
  const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const previous=global.fetch;
  try {
    process.env.SHAHVEX_PC_AI_URL='https://ai.example.com';
    process.env.SHAHVEX_PC_AI_SECRET='s'.repeat(32);
    process.env.SHAHVEX_CF_CLIENT_ID='client';process.env.SHAHVEX_CF_CLIENT_SECRET='private';
    let calls=0;
    global.fetch=async(url,init)=>{calls++;assert.equal(url.href,'https://ai.example.com/engine/8767/voices');assert.equal(init.headers.get('cookie'),null);assert.equal(init.headers.get('authorization'),null);assert.equal(init.headers.get('x-shahvex-ai-key'),'s'.repeat(32));assert.equal(init.redirect,'error');return new Response('{}');};
    await mod.exports.pcAiEngine(8767,'/voices',{headers:{cookie:'user-session',authorization:'user-token'}});
    await assert.rejects(mod.exports.pcAiEngine(8767,'/voices?url=evil'));
    await assert.rejects(mod.exports.pcAiEngine(1234,'/voices'));
    process.env.SHAHVEX_PC_AI_URL='http://ai.example.com';
    await assert.rejects(mod.exports.pcAiEngine(8767,'/voices'));
    assert.equal(calls,1);
  } finally {global.fetch=previous;for(const n of names)if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}
});
