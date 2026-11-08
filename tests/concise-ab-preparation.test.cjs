'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPlan,runInjected}=require('../gateway/style-review/prepare-concise-ab.cjs');
const healthy={status:200,authenticated:true,ready:true,maintenance:true,activeSessions:0,queue:{active:0,pending:0},activeRelays:0,startingRelays:0};
test('30 reproducibly randomized trial slots, three repeats per exact variant; 66 sequential phrase jobs planned',()=>{
  const p=buildPlan('offline-test');assert.deepEqual(p,buildPlan('offline-test'));assert.equal(p.texts.length,10);assert.equal(p.trials.length,30);assert.equal(p.plannedNativeRequests,66);
  assert.equal(new Set(p.trials.map(t=>t.blindId)).size,30);
  for(const t of p.texts){assert.equal(p.trials.filter(x=>x.textId===t.id).length,3);assert.equal(t.phrases.join(' '),t.text);for(const s of t.mandatory)assert.ok(t.text.includes(s));}
});
test('missing approval, unverified maintenance or unknown competing tests never reaches synthesis',async()=>{
  const p=buildPlan('guard-test');let calls=0;
  const dependencies={guard:async()=>healthy,noOtherTests:async()=>true,requestWav:async()=>{calls++;},save:async()=>{}};
  await assert.rejects(runInjected(p,dependencies),/approval/);
  for(const changes of [{maintenance:false},{authenticated:false},{activeRelays:1},{startingRelays:1},{queue:{active:0,pending:1}}]){
    const r=await runInjected(p,{...dependencies,approved:true,guard:async()=>({...healthy,...changes})});assert.ok(r.stopped);assert.equal(r.completed,0);
  }
  assert.ok((await runInjected(p,{...dependencies,approved:true,noOtherTests:async()=>false})).stopped);assert.equal(calls,0);
});
test('first corrupted phrase stops whole plan with no save, retry or subsequent native job',async()=>{
  let calls=0,saves=0;
  const r=await runInjected(buildPlan('failure-test'),{approved:true,guard:async()=>healthy,noOtherTests:async()=>true,
    requestWav:async()=>{calls++;return {status:200,wav:Buffer.alloc(44),declaredBytes:88};},save:async()=>{saves++;}});
  assert.equal(calls,1);assert.equal(saves,0);assert.equal(r.completed,0);assert.equal(r.unrun,29);assert.ok(r.stopped);
});
