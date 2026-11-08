const {test}=require('node:test');const assert=require('node:assert/strict');
const {Gateway}=require('../gateway/core.cjs');const {AudioStream}=require('../gateway/audio-stream.cjs');const {report}=require('../gateway/timing-report.cjs');
test('400ms endpoint preserves a 300ms natural pause and submits exactly one turn with shared correlation ID',async()=>{
  let transcriptions=0;const events=[];const g=new Gateway({voices:[{id:'fixture',verified:true}],stt:async()=>{transcriptions++;return'fixture';},llm:async()=> 'response',tts:async()=>Buffer.alloc(640)});
  const id=g.create('owner',{script:'Disclose automation',campaignId:'fixture',direction:'inbound',voiceId:'fixture'});
  const s=new AudioStream(g,'owner',id,async e=>events.push(e));const voice=Buffer.alloc(6400);for(let i=0;i<voice.length;i+=2)voice.writeInt16LE(2000,i);
  await s.push(voice);await s.push(Buffer.alloc(640*15));assert.equal(transcriptions,0);
  await s.push(voice);await s.push(Buffer.alloc(640*19));assert.equal(transcriptions,0);
  await s.push(Buffer.alloc(640));await s.end();
  const end=events.find(e=>e.type==='speech-end');assert.equal(end.vadDelayMs,400);assert.equal(transcriptions,1);
  assert.ok(events.filter(e=>e.type==='timing').every(e=>e.turnId===end.turnId));s.close();g.close('owner',id);
});
test('timing report keeps unmeasured acoustic delay null; never substitutes silence durations',()=>{
  const r=report([{turnId:'a',stage:'speech-end',vadDelayMs:400},{turnId:'a',stage:'stt-start',gatewayElapsedMs:10},{turnId:'a',stage:'stt-complete',gatewayElapsedMs:160}]);
  assert.equal(r[0].sttMs,150);assert.equal(r[0].vadEndpointMs,400);assert.equal(r[0].acousticSpeechEndToAudibleMs,null);assert.equal(r[0].ttsFirstPcmMs,null);
});
