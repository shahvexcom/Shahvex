'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makePlan,idle,renderSample}=require('../gateway/style-review/listening-harness.cjs');
const {disclosure}=require('../gateway/style-review/approved-listening.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare,saveSample}=require('../gateway/style-review/listening-harness.cjs');
const healthy={status:200,authenticated:true,ready:true,maintenance:true,activeSessions:0,queue:{active:0,pending:0},activeRelays:0,startingRelays:0};
function wav(){const h=Buffer.alloc(44+320);h.write('RIFF');h.writeUInt32LE(h.length-8,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(320,40);return h;}
test('ten exact approved generic texts; unchanged phrase policy and disclosure',()=>{
  const p=makePlan();assert.equal(p.samples.length,10);assert.equal(new Set(p.order).size,10);
  for(const s of p.samples){assert.ok(s.text.includes(disclosure));assert.equal(s.phrases.join(' '),s.text);assert.ok(!s.text.includes('20 minutes'));}
  assert.equal(p.samples[0].text,p.samples[1].text);assert.equal(p.audioGenerated,false);
});
test('separate approval and fresh healthy maintenance snapshots required',async()=>{
  const sample=makePlan().samples[0];let calls=0;
  await assert.rejects(renderSample(sample,{guard:async()=>healthy,requestWav:async()=>{calls++;}}),/approval/);
  for(const field of ['authenticated','ready','maintenance'])assert.throws(()=>idle({...healthy,[field]:false}),/guard/);
  for(const field of ['activeSessions','activeRelays','startingRelays'])assert.throws(()=>idle({...healthy,[field]:1}),/guard/);
  assert.throws(()=>idle({...healthy,queue:{active:0,pending:1}}),/guard/);assert.equal(calls,0);
});
test('sequential synthetic WAV synthesis preserves native rate and reports projected gaps honestly',async()=>{
  let active=0,peak=0,calls=0,guards=0;
  const sample=makePlan().samples.find(s=>s.id==='hesitant-style-aware');
  const r=await renderSample(sample,{approved:true,guard:async()=>{guards++;return healthy;},requestWav:async body=>{
    assert.deepEqual(Object.keys(body),['text']);calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;const w=wav();return {status:200,wav:w,declaredBytes:w.length};}});
  assert.equal(peak,1);assert.equal(calls,sample.phrases.length);assert.equal(guards,calls);assert.equal(r.wav.readUInt32LE(24),24000);
  assert.equal(r.metrics.actualAudibleLatencyMs,null);assert.equal(r.metrics.nativeInferenceMs,null);
});
test('truncation/transfer errors stop without retry or later synthesis',async()=>{
  for(const failure of ['mismatch','disconnect']){let calls=0;
    await assert.rejects(renderSample(makePlan().samples[0],{approved:true,guard:async()=>healthy,requestWav:async()=>{
      calls++;if(failure==='disconnect')throw Error('synthetic disconnect');return {status:200,wav:wav(),declaredBytes:999};}}));assert.equal(calls,1);
  }
});
test('preparation creates only text/plan; later synthetic save labels, blinds and preserves originals',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-listening-')),root=path.join(parent,'review');
  try{const p=prepare(root);assert.equal(fs.readdirSync(path.join(root,'texts')).length,10);assert.equal(fs.readdirSync(path.join(root,'audio-labeled')).length,0);assert.throws(()=>prepare(root));
    const s=p.samples[0],w=wav();saveSample(root,s,{wav:w,phraseWavs:[w],metrics:{synthetic:true}});
    assert.ok(fs.readFileSync(path.join(root,'audio-labeled',s.id+'.wav')).equals(w));
    const blind=fs.readdirSync(path.join(root,'audio-blind'));assert.equal(blind.length,1);assert.ok(!blind[0].includes(s.scenario));
    assert.ok(fs.readFileSync(path.join(root,'audio-blind',blind[0])).equals(w));assert.throws(()=>saveSample(root,s,{wav:w,phraseWavs:[w],metrics:{}}));
  }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
