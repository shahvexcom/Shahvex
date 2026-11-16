const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/campaign-operation-error.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,mod,mod.exports);
test('campaign failures distinguish actual duplicate constraints from internal SQL errors without leaking input',async()=>{
 const logs=[],original=console.error;console.error=(...args)=>logs.push(args);
 try{
  const duplicate=mod.exports.campaignOperationFailure({name:'error',code:'23505',message:'private script'});assert.equal(duplicate.status,409);assert.match((await duplicate.json()).error,/already exists/);
  const internal=mod.exports.campaignOperationFailure({name:'error',code:'42P08',message:'private password'});assert.equal(internal.status,503);const body=await internal.json();assert.match(body.error,/Reference:/);assert.doesNotMatch(body.error,/duplicate|private/);assert.doesNotMatch(JSON.stringify(logs),/private/);assert.equal(logs[1][1].code,'42P08');
  const foreign=mod.exports.campaignOperationFailure({code:'23503'});assert.match((await foreign.json()).error,/select it again/);
  const timeout=mod.exports.campaignOperationFailure({name:'TimeoutError'});assert.equal(timeout.status,503);assert.match((await timeout.json()).error,/timed out/);
 }finally{console.error=original;}
});
