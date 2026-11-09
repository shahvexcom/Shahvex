const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(n => Object.hasOwn(deps,n) ? deps[n] : require(n), m, m.exports); return m.exports;
}
const audio = load('lib/agent-test-audio.ts');
const details = load('lib/agent-script-details.ts');
const { BrowserSpeechCapture } = load('lib/browser-speech-capture.ts', { './agent-test-audio': audio });
const service = load('lib/agent-test.ts', { 'server-only': {} });
const cfg = { name: 'Test', voice: 'voice', first: 'customer', goal: '', task: '', instructions: '', script: '', knowledge: '', style: 'Friendly' };
const speech = () => Int16Array.from({length:320}, (_,i) => Math.round(Math.sin(i*.17)*2500));
const silence = () => new Int16Array(320);
test('one speech segment followed by silence produces exactly one finalized recording', async () => {
  const c = new BrowserSpeechCapture(); const recordings=[];
  for (let i=0;i<25;i++) { const r=c.feed(speech(),false); if(r.recording)recordings.push(r.recording); }
  for (let i=0;i<500;i++) { const r=c.feed(silence(),false); if(r.recording)recordings.push(r.recording); }
  assert.equal(recordings.length,1);
  const report=audio.inspectSpeechWav(new Uint8Array(await recordings[0].blob.arrayBuffer()));
  assert.equal(report.speech,true); assert.ok(report.voicedMs>=400);
  c.reset(); for(let i=0;i<100;i++)assert.equal(c.feed(silence(),false).recording,undefined);
});
test('short noise and actual playback-correlated echo never finalize customer speech', () => {
  const c = new BrowserSpeechCapture();
  for(let i=0;i<3;i++)c.feed(speech(),false);
  for(let i=0;i<80;i++)assert.equal(c.feed(silence(),false).recording,undefined);
  const reference=Float32Array.from(speech(),x=>x/32768);
  for(let i=0;i<50;i++){c.playback(reference);const result=c.feed(speech(),true);assert.equal(result.echo,true);assert.equal(result.recording,undefined);}
});
test('strict extraction filters unsupported facts and rejects malformed structured JSON', () => {
  const script='Goal: Schedule appointments. Never promise a discount.';
  const d=details.groundedDetails(script,{...details.emptyScriptDetails(),goals:['Schedule appointments.','Offer a 50% discount.'],restrictions:['Never promise a discount.']});
  assert.deepEqual(d.goals,['Schedule appointments.']); assert.deepEqual(d.faqs,[]);
  assert.throws(()=>details.groundedDetails(script,{goals:'not an array'}));
});
function route(engine, extra={}) { return load('app/api/admin/agent-test/route.ts', {
  '@/lib/agent-test-stream':load('lib/agent-test-stream.ts'), '@/lib/agent-script-extraction':{extractAgentScript:async()=>details.emptyScriptDetails()}, '@/lib/agent-script-details':details, '@/lib/agent-test-audio':audio,
  'next/headers':{cookies:async()=>({get:()=>({value:'test'})})}, '@/lib/session':{readSession:async()=>({role:'ADMIN',agentId:'admin'})}, '@/lib/database':{}, '@/lib/agent-test':{...service,engine}, ...extra,
}); }
const request=(id,turnId,body,type='audio/wav')=>new Request(`http://localhost:3000/api/admin/agent-test?action=turn&id=${id}&turnId=${turnId}`,{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':type},body});
test('silent recordings are rejected before STT and never create customer messages', async () => {
  const id=service.newTest('admin','agent',cfg); let calls=0;
  const r=await route(async()=>{calls++;throw Error('Must not call STT');}).POST(request(id,'silent-turn',await audio.speechWav(Array.from({length:60},silence)).arrayBuffer()));
  const events=(await r.text()).trim().split('\n').map(JSON.parse);
  assert.equal(calls,0); assert.ok(events.some(e=>e.type==='rejected')); assert.equal(events.some(e=>e.type==='user'),false); assert.equal(service.sessions.get(id).messages.length,1);
});
test('audio and turn IDs deduplicate final transcripts; cancelled STT cannot commit a message', async () => {
  const id=service.newTest('admin','agent',cfg), blob=await audio.speechWav(Array.from({length:25},speech)).arrayBuffer();let stt=0;
  const api=route(async(port)=>{if(port===8766){stt++;return Response.json({text:'One actual sentence.'});}if(port===11434)return new Response(JSON.stringify({message:{content:'I heard you.'},done:true})+'\n');return new Response(new Uint8Array(4800).fill(16),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});});
  const first=(await(await api.POST(request(id,'actual-turn',blob))).text()).split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(first.filter(e=>e.type==='user').length,1);assert.equal(first.find(e=>e.type==='user').source,'stt');assert.equal(first.find(e=>e.type==='user').final,true);
  assert.equal((await api.POST(request(id,'actual-turn',blob))).status,409);
  const copy=await(await api.POST(request(id,'duplicate-audio',blob))).text();assert.ok(copy.includes('rejected'));assert.equal(stt,1);
  const cancelledId=service.newTest('admin','agent',cfg);
  const cancelled=route(async(port)=>{assert.equal(port,8766);service.sessions.get(cancelledId).abort.abort();return Response.json({text:'A stale transcript.'});});
  await(await cancelled.POST(request(cancelledId,'cancelled-turn',blob))).text();
  assert.equal(service.sessions.get(cancelledId).messages.length,1);
});
test('session start derives business fields exclusively from the freshly extracted current script', async () => {
  let extractedScript='';
  const api=route(async()=>{}, {
    '@/lib/agent-script-extraction':{extractAgentScript:async(owner,script)=>{extractedScript=script;return {...details.emptyScriptDetails(),goals:['Book a visit.']};}},
    '@/lib/database':{db:async()=>({query:async()=>({rows:[{name:'Saved Name'}]})})},
    '@/lib/agent-test':{...service,localVoices:async()=>({voices:[{id:'voice'}]}),warmSelectedVoice:async()=>{}},
  });
  const r=await api.POST(new Request('http://localhost:3000/api/admin/agent-test?action=start',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({agentId:'agent',config:{...cfg,script:'Book a visit.',goal:'Forged goal',knowledge:'Invented price'}})}));
  const s=service.sessions.get((await r.json()).id);assert.equal(extractedScript,'Book a visit.');assert.equal(s.config.goal,'Book a visit.');assert.equal(s.config.knowledge,'');assert.equal(s.config.name,'Saved Name');
});
