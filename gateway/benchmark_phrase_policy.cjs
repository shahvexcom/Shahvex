'use strict';
// Offline boundary replay only. No network/model/config/runtime file changes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./phrase-stream.cjs'),'utf8');
const fixtures=[
  'I am Jennifer, an automated assistant, and I can explain the service. Please confirm that you consent to continue.',
  'I am an automated assistant, and I can answer your questions. Please confirm your consent.',
  'Please confirm that you consent to continue this local conversation. I can then answer your questions.'
];
const rows=[];
for(const minimum of [40,32,24]){
  assert.equal(source.split('sentence?24:40').length,2);
  const sandbox={module:{exports:{}},Error};
  vm.runInNewContext(source.replace('sentence?24:40',`sentence?24:(this.benchmarkEmitted?40:${minimum})`),sandbox);
  const PhraseStream=sandbox.module.exports.PhraseStream;
  for(const [index,text] of fixtures.entries()){
    let at=0,firstAt=null;const chunks=[];
    const p=new PhraseStream(new AbortController().signal,chunk=>{p.benchmarkEmitted++;chunks.push(chunk);firstAt??=at;});p.benchmarkEmitted=0;
    // One character per synthetic tick tests unfinished-word handling, not token speed.
    for(const character of text){at++;p.push(character);}p.finish(text);
    assert.equal(chunks.join(' ').replace(/\s+/g,' ').trim(),text);
    rows.push({firstClauseMinimum:minimum,fixture:index+1,firstPhraseCharacters:chunks[0].length,firstReadySyntheticTick:firstAt,phrases:chunks.length,wordsPreserved:true});p.dispose();
  }
}
console.log(JSON.stringify({measurement:'synthetic boundary replay only; ticks are not milliseconds and do not predict hardware latency',rows},null,2));
