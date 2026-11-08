const {test}=require('node:test');const assert=require('node:assert/strict');
const {Gateway}=require('../gateway/core.cjs');const {createServices}=require('../gateway/services.cjs');const {PhraseStream}=require('../gateway/phrase-stream.cjs');
const config={agentName:'Jennifer',voiceId:'fixture',script:'Disclose automation. Preserve mandatory consent exactly.',campaignId:'local',direction:'inbound'};
const first='I am Jennifer, your automated Shahvex assistant.';
const rest=' Please confirm that you consent to continue.';
const packet=(content,done=false)=>Buffer.from(JSON.stringify({message:{content},done})+'\n');
function wav(){const w=Buffer.alloc(44+640);w.write('RIFF');w.writeUInt32LE(w.length-8,4);w.write('WAVEfmt ',8);w.writeUInt32LE(16,16);w.writeUInt16LE(1,20);w.writeUInt16LE(1,22);w.writeUInt32LE(16000,24);w.writeUInt32LE(32000,28);w.writeUInt16LE(2,32);w.writeUInt16LE(16,34);w.write('data',36);w.writeUInt32LE(640,40);return w;}
const contract={ollamaStreaming:true,tts:{protocol:'chatterbox-wav',url:'http://127.0.0.1:8765/synthesize'}};
test('first PCM precedes Ollama completion; arbitrary token boundaries retain every disclosure word and ordered audio',{timeout:3000},async()=>{
  let controller,active=0,peak=0;const texts=[],events=[],audio=[],prompts=[];
  const services=createServices(contract,async(url,options)=>{
    if(String(url).includes('/api/chat')){
      prompts.push(JSON.parse(options.body));
      return new Response(new ReadableStream({start(c){controller=c;c.enqueue(packet('I am Jen'));c.enqueue(packet('nifer, your automated Shahvex assistant. '));}}));
    }
    texts.push(JSON.parse(options.body).text);active++;peak=Math.max(peak,active);
    return new Response(new ReadableStream({start(c){setImmediate(()=>{active--;c.enqueue(wav());c.close();});}}));
  });
  const g=new Gateway({...services,stt:async()=> 'question',voices:[{id:'fixture',verified:true}]});const id=g.create('o',config);
  try{
    const result=await g.turn('o',id,Buffer.alloc(640),16000,chunk=>{
      audio.push(chunk);if(audio.length===1){assert.ok(!events.some(e=>e.stage==='llm-complete'));controller.enqueue(packet(rest.trimStart()));controller.enqueue(packet('',true));controller.close();}
    },event=>events.push(event));
    assert.equal(result.reply,first+rest);assert.equal(texts.join(' '),first+rest);assert.equal(peak,1);assert.equal(audio.length,2);
    assert.ok(prompts[0].stream);assert.ok(prompts[0].messages[0].content.endsWith(config.script));
    assert.ok(events.findIndex(e=>e.stage==='tts-first-audio')<events.findIndex(e=>e.stage==='llm-complete'));
    assert.ok(events.findIndex(e=>e.stage==='llm-first-token')<events.findIndex(e=>e.stage==='llm-first-text-chunk'));
    assert.equal(g.owned('o',id).history[1].content,first+rest);
  }finally{g.close('o',id);}
});
test('partial words, decimal numbers and abbreviations are retained; clauses are bounded without invented text',async()=>{
  const p=new PhraseStream(new AbortController().signal);p.push('Please speak to Dr. ');assert.equal(p.queue.length,0);
  p.push('Smith about the price of 3.');p.push('50 dollars, ');
  p.push('then confirm your consent before proceeding.');
  const full=p.text;p.finish(full);const chunks=[];for await(const phrase of p)chunks.push(phrase);
  assert.equal(chunks.join(' '),full);assert.ok(chunks.every(x=>x.length<=300));assert.ok(chunks[0].includes('Dr. Smith'));assert.ok(chunks[0].includes('3.50'));
  const q=new PhraseStream(new AbortController().signal);q.push('An automated assist');assert.equal(q.queue.length,0);q.push('ant can answer your questions. ');assert.equal(q.queue[0],'An automated assistant can answer your questions.');q.dispose();p.dispose();
});
test('LLM failure during native synthesis remains an LLM error, drops queued audio/history and drains work',{timeout:3000},async()=>{
  let controller,release,entered;const ready=new Promise(r=>{entered=r});let played=0;
  const services=createServices(contract,async(url,options)=>{
    if(String(url).includes('/api/chat'))return new Response(new ReadableStream({start(c){controller=c;c.enqueue(packet(first+' '));}}));
    entered();await new Promise(r=>{release=r});assert.equal(options.signal.aborted,false);return new Response(wav());
  });
  const g=new Gateway({...services,stt:async()=> 'question',voices:[{id:'fixture',verified:true}]});const id=g.create('o',config);
  const turn=g.turn('o',id,Buffer.alloc(640),16000,()=>{played++});const rejected=assert.rejects(turn,e=>e.engineStage==='llm'&&e.name!=='AbortError');
  await ready;controller.error(Error('synthetic Ollama stream failure'));await new Promise(r=>setImmediate(r));release();await rejected;
  assert.equal(played,0);assert.equal(g.owned('o',id).history.length,0);g.close('o',id);
});
test('barge-in aborts token producer, drains accepted native synthesis and never emits stale phrase audio',{timeout:3000},async()=>{
  let release,entered;const ready=new Promise(r=>{entered=r});let played=0,aborted=false,ttsCalls=0;
  const services=createServices(contract,async(url,options)=>{
    if(String(url).includes('/api/chat'))return new Response(new ReadableStream({start(c){c.enqueue(packet(first+' '));options.signal.addEventListener('abort',()=>{aborted=true;c.error(options.signal.reason);},{once:true});}}));
    ttsCalls++;entered();await new Promise(r=>{release=r});assert.equal(options.signal.aborted,false);return new Response(wav());
  });
  const g=new Gateway({...services,stt:async()=> 'question',voices:[{id:'fixture',verified:true}]});const id=g.create('o',config);
  const turn=g.turn('o',id,Buffer.alloc(640),16000,()=>{played++});const rejected=assert.rejects(turn,e=>e.name==='AbortError');
  await ready;g.interrupt('o',id);await new Promise(r=>setImmediate(r));assert.equal(g.queue.active,1);assert.ok(aborted);
  release();await rejected;assert.equal(played,0);assert.equal(ttsCalls,1);assert.equal(g.owned('o',id).history.length,0);g.close('o',id);
});
test('bounded producer rejects oversized text and final/delta mismatch rather than speaking duplicates',()=>{
  const p=new PhraseStream(new AbortController().signal);assert.throws(()=>p.push('x'.repeat(16001)),/limit/);p.dispose();
  const q=new PhraseStream(new AbortController().signal);q.push('An unchanged complete sentence. ');assert.throws(()=>q.finish('A rewritten response.'),/differs/);q.dispose();
});
