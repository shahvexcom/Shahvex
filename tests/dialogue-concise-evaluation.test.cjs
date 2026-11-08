'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../gateway/style-review/concise-evaluation.cjs');
test('four intent examples retain mandatory spans, script prefix and history',()=>{
  const r=evaluate();assert.equal(r.rows.length,5);
  for(const p of r.rows){assert.equal(p.intent,p.expectedIntent);assert.ok(p.exactRequiredSpansPreserved);assert.ok(p.inputScriptUnchanged&&p.historyUnchanged);
    assert.equal(p.firstAudibleImprovementMs,null);assert.equal(p.betweenPhraseGapMs,null);
    assert.ok(!p.proposed.text.includes('[laugh]'));assert.equal(p.extraNativeJobs<=0,true);
  }
});
test('mandatory-first control does not claim reduced first-phrase work',()=>{
  const p=evaluate().rows.find(p=>p.scenario==='mandatory-first-control');
  assert.equal(p.firstPhraseCharacterReduction,0);assert.equal(p.baseline.firstPhraseCharacters,38);
});
