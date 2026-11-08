'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,assertIdle,scenarios}=require('../gateway/intelligence-compatibility.cjs');
test('idle gate rejects unavailable, active and partially supplied status',()=>{
  const idle={authenticated:true,ready:true,activeSessions:0,queue:{active:0,pending:0},activeRelays:0,startingRelays:0};
  assertIdle(idle);for(const changed of [{authenticated:false},{ready:false},{activeSessions:1},{queue:{active:0,pending:1}},{startingRelays:1},{activeRelays:1}])assert.throws(()=>assertIdle({...idle,...changed}));
  assert.throws(()=>assertIdle({}));
});
test('matched isolated conversations preserve histories and one call per turn without native audio',async()=>{
  let checks=0,requests=0;const seen=[];
  const result=await evaluate({beforeRequest:async()=>{checks++;},llm:async(messages,_signal,timing,delta)=>{
    requests++;seen.push(messages);const candidate=messages[0].content.includes('AGENT INTELLIGENCE RESPONSE PROTOCOL');
    const text=candidate?'{"kind":"general","text":"We can explore the topic you described together."}\n':'We can explore the topic you described together.';
    timing('llm-first-token');for(let i=0;i<text.length;i+=5)delta(text.slice(i,i+5));return text;
  }});
  assert.equal(result.stopped,false);assert.equal(requests,20);assert.equal(checks,20);
  assert.equal(result.rows.length,20);assert.ok(result.rows.every(r=>r.firstMeaningfulTextMs!==null));
  for(const variant of ['baseline','candidate'])for(const s of scenarios())assert.deepEqual(result.rows.filter(r=>r.variant===variant&&r.agent===s.name).map(r=>r.historyMessages),[2,4,6,8,10]);
  for(const messages of seen){const garden=messages[0].content.includes('synthetic-garden');assert.ok(!messages[0].content.includes(garden?'synthetic-library':'synthetic-garden'));}
});
test('failed safety guard prevents model request and stops without retry',async()=>{
  let calls=0;const result=await evaluate({beforeRequest:async()=>{throw Error('Production active');},llm:async()=>{calls++;}});
  assert.equal(calls,0);assert.equal(result.stopped,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].modelStarted,false);
});
test('protocol mismatch aborts candidate evaluation without automatic regeneration',async()=>{
  const result=await evaluate({beforeRequest:async()=>{},llm:async(_m,_s,_t,delta)=>{const t='Plain text, without the required protocol.';delta(t);return t;}});
  assert.equal(result.stopped,true);assert.equal(result.rows.length,11);assert.ok(result.rows.at(-1).error);assert.equal(result.rows.at(-1).historyMessages,0);
});
test('final valid protocol record without newline gets a meaningful-text observation',async()=>{
  const r=await evaluate({variants:['candidate'],beforeRequest:async()=>{},llm:async(_m,_s,_t,delta)=>{const text='{"kind":"fact","id":"guide"}';delta(text);return text;}});
  assert.equal(r.stopped,false);assert.ok(r.rows.every(row=>row.firstMeaningfulTextMs!==null));
});
