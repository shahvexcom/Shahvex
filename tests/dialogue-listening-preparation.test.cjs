'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareListening}=require('../gateway/style-review/prepare-listening.cjs');
test('five text pairs preserve fixture words, facts and order with optional prepend only',()=>{
  const r=prepareListening();assert.deepEqual(r.pairs.map(p=>p.scenario),['neutral','friendly','hesitant','concerned','serious']);
  assert.deepEqual(r.pairs.map(p=>p.intent),['neutral','warm','reassuring','reassuring','serious']);
  for(const p of r.pairs){assert.equal(p.styleAware,p.difference.optionalText+p.baseline);assert.ok(p.exactFixtureAudit);assert.deepEqual(p.difference.mandatoryOrFactualChanges,[]);assert.equal(p.difference.removedText,'');}
  assert.ok(r.pairs[0].identicalTextControl);assert.equal(r.audioGenerated,false);assert.equal(r.liveRequests,0);
  assert.match(r.realApprovedScriptValidation,/PENDING/);assert.match(r.source,/not Ollama-generated/);
});
