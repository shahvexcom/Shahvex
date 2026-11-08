const {test}=require('node:test');const assert=require('node:assert/strict');
const {Gateway}=require('../gateway/core.cjs');const {AudioStream}=require('../gateway/audio-stream.cjs');
const frame=Buffer.alloc(640);for(let i=0;i<640;i+=2)frame.writeInt16LE(2000,i);
test('100ms noise cannot cancel an active response or create an empty replacement turn',async()=>{
  let release,entered;let calls=0;const ready=new Promise(r=>{entered=r});const events=[];
  const g=new Gateway({voices:[{id:'fixture',verified:true}],stt:async()=>{calls++;entered();await new Promise(r=>{release=r});return 'real question'},llm:async()=> 'answer',tts:async()=>Buffer.alloc(640)});
  const id=g.create('owner',{script:'Assigned script',campaignId:'fixture',direction:'inbound',voiceId:'fixture'});
  const turn=g.turn('owner',id,Buffer.alloc(640));const settled=turn.catch(e=>e);await ready;
  const generation=g.owned('owner',id).generation;
  const s=new AudioStream(g,'owner',id,async e=>events.push(e));
  try{for(let i=0;i<5;i++)await s.push(frame);await s.push(Buffer.alloc(640*20));
    assert.equal(g.owned('owner',id).generation,generation);assert.equal(events.filter(e=>e.type==='clear').length,0);
    release();await settled;await s.end();assert.equal(calls,1);assert.equal(g.owned('owner',id).history.length,2);
  }finally{release();s.close();g.close('owner',id);await settled;}
});
test('sustained onset retains its initial PCM and interrupts exactly once',async()=>{
  let interrupts=0,captured;const events=[];const fake={log(){},owned:()=>({generation:1}),interrupt(){interrupts++},async turn(_o,_i,a){captured=a;return {generation:1}}};
  const s=new AudioStream(fake,'o','i',async e=>events.push(e));
  for(let i=0;i<8;i++)await s.push(frame);await s.push(Buffer.alloc(640*20));await s.end();
  assert.equal(interrupts,1);assert.equal(events.filter(e=>e.type==='clear').length,1);
  assert.equal(captured.length,640*28);assert.deepEqual(captured.subarray(0,640*8),Buffer.concat(Array(8).fill(frame)));
});
