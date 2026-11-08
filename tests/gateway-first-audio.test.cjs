const {test}=require('node:test');const assert=require('node:assert/strict');
const {textChunks}=require('../gateway/text-chunks.cjs');const {createServices}=require('../gateway/services.cjs');
test('first meaningful sentence is synthesized separately without truncating or reordering script wording',()=>{
  const first='I am Jennifer, an automated Shahvex assistant.';
  const text=first+' Please confirm you consent to continue. All required conditions remain applicable.';
  const parts=textChunks(text);assert.equal(parts[0],first);assert.equal(parts.join(' '),text);assert.ok(parts.every(p=>p.length<=300));
});
test('cancelled native STT stays outstanding until backend completes; no model-stage request overlap',async()=>{
  const {Gateway}=require('../gateway/core.cjs');let release,entered;const ready=new Promise(r=>{entered=r;});let requests=0;
  const services=createServices({stt:{protocol:'pcm16-json-text',url:'http://127.0.0.1:8788/transcribe'}},async(_url,options)=>{
    requests++;if(requests===1){entered();await new Promise(r=>{release=r;});assert.equal(options.signal.aborted,false);}return Response.json({text:'hello'});
  });
  const g=new Gateway({...services,voices:[{id:'fixture',verified:true}],llm:async()=> 'Response',tts:async()=>Buffer.alloc(640)});
  const id=g.create('owner',{script:'Assigned script',campaignId:'fixture',direction:'inbound',voiceId:'fixture'});
  const first=g.turn('owner',id,Buffer.alloc(640));const rejected=assert.rejects(first,e=>e.name==='AbortError');await ready;
  const second=g.turn('owner',id,Buffer.alloc(640));await Promise.resolve();assert.equal(requests,1);assert.equal(g.queue.active,1);
  release();await rejected;await second;assert.equal(requests,2);assert.equal(g.owned('owner',id).history.length,2);g.close('owner',id);
});
test('first sentence PCM is yielded before later sentence synthesis begins',async()=>{
  const wav=Buffer.alloc(44+1280);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1280,40);
  const requests=[];
  const services=createServices({tts:{protocol:'chatterbox-wav',url:'http://127.0.0.1:8765/synthesize'}},async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(wav);});
  const text='I am Jennifer, your automated Shahvex assistant. Please confirm that you consent to continue.';
  const iterator=services.tts(text,'unchanged-voice',new AbortController().signal);
  const first=await iterator.next();assert.equal(first.value.length,640);assert.equal(requests.length,1);assert.equal(requests[0].text,'I am Jennifer, your automated Shahvex assistant.');
  for await(const _chunk of iterator){}
  assert.equal(requests.length,2);assert.equal(requests.map(r=>r.text).join(' '),text);assert.ok(requests.every(r=>!('voice' in r)));
});

test('cancelled accepted Chatterbox request drains before the next turn; stale WAV is never played',async()=>{
  const {Gateway}=require('../gateway/core.cjs');let release,entered;const ready=new Promise(r=>{entered=r});let requests=0,active=0,peak=0;
  const wav=Buffer.alloc(44+640);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(640,40);
  const services=createServices({tts:{protocol:'chatterbox-wav',url:'http://127.0.0.1:8765/synthesize'}},async(_url,options)=>{
    requests++;active++;peak=Math.max(peak,active);
    if(requests===1)return new Response(new ReadableStream({start(controller){entered();release=()=>{assert.equal(options.signal.aborted,false);active--;controller.enqueue(wav);controller.close();}}}));
    active--;return new Response(wav);
  });
  const g=new Gateway({...services,voices:[{id:'fixture',verified:true}],stt:async()=> 'question',llm:async()=> 'A complete reply.'});
  const id=g.create('o',{script:'Assigned script',campaignId:'fixture',direction:'inbound',voiceId:'fixture'});const played=[];
  const first=g.turn('o',id,Buffer.alloc(640),16000,()=>{throw Error('Stale audio played')});const cancelled=assert.rejects(first,e=>e.name==='AbortError');await ready;
  const second=g.turn('o',id,Buffer.alloc(640),16000,c=>played.push(c));await Promise.resolve();
  assert.equal(requests,1);assert.equal(g.queue.active,1);release();await cancelled;await second;
  assert.equal(peak,1);assert.equal(requests,2);assert.equal(played.length,1);assert.equal(g.owned('o',id).history.length,2);
  await new Promise(r=>setImmediate(r));assert.equal(g.queue.active,0);g.close('o',id);
});
