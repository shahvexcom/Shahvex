const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {plan,runTrial}=require('../gateway/native-ab.cjs');
const source=fs.readFileSync(require.resolve('../gateway/phrase-stream.cjs'),'utf8');const texts=require('../gateway/native-ab-fixtures.json');
test('synthetic native A/B has exactly 30 repeatable randomized trials, same wording and only first threshold differs',()=>{
  const trials=plan(texts,source,'fixture-seed');assert.equal(trials.length,30);
  assert.deepEqual(trials,plan(texts,source,'fixture-seed'));assert.notDeepEqual(trials,plan(texts,source,'other-seed'));
  for(let fixture=1;fixture<=5;fixture++)for(const variant of ['A','B']){
    const selected=trials.filter(t=>t.fixture===fixture&&t.variant===variant);assert.equal(selected.length,3);
    assert.deepEqual(selected.map(t=>t.repeat).sort(),[1,2,3]);for(const trial of selected){assert.equal(trial.phrases.join(' '),texts[fixture-1]);assert.ok(trial.phrases.every(t=>t.length<=300));}
  }
  assert.equal(fs.readFileSync(require.resolve('../gateway/phrase-stream.cjs'),'utf8'),source);
});
test('native benchmark models ordered buffering gaps and separates guard overhead without overlapping synthesis',async()=>{
  let time=0,active=0,peak=0,call=0;
  const services={async *tts(text,voice,signal){assert.equal(voice,'approved');assert.equal(signal.aborted,false);active++;peak=Math.max(peak,active);time+=++call===1?100:300;yield Buffer.alloc(3200);active--;}};
  const result=await runTrial({phrases:['first phrase','second phrase']},services,'approved',async()=>{time+=10},()=>time);
  assert.equal(peak,1);assert.equal(result.firstPcmMs,100);assert.equal(result.synthesisCompleteMs,400);assert.equal(result.guardOverheadMs,10);assert.equal(result.wallCompleteMs,410);
  assert.equal(result.projectedGapWorstMs,200);assert.equal(result.projectedPlaybackCompleteMs,530);
});
