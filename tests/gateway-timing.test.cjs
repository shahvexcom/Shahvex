const {test}=require('node:test');const assert=require('node:assert/strict');
const {Gateway}=require('../gateway/core.cjs');const {createServices}=require('../gateway/services.cjs');
test('full assigned script and bounded role history reach LLM; correlated metadata contains no transcript',async()=>{
  const logs=[],events=[],messages=[];const script='Mandatory: disclose automation. Consent is required.';
  const g=new Gateway({voices:[{id:'verified',verified:true}],stt:async()=> 'private spoken fixture',llm:async m=>{messages.push(m);return 'private reply fixture';},tts:async()=>Buffer.alloc(640),log:e=>logs.push(e)});
  const id=g.create('owner',{agentName:'Jennifer',script,campaignId:'fixture',voiceId:'verified',direction:'inbound'});
  await g.turn('owner',id,Buffer.alloc(640),16000,undefined,e=>events.push(e));
  await g.turn('owner',id,Buffer.alloc(640));
  assert.ok(messages[0][0].content.endsWith(script));assert.match(messages[0][0].content,/Jennifer/);
  assert.equal(messages[1][1].role,'user');assert.equal(messages[1][2].role,'assistant');
  for(const stage of ['stt-start','stt-complete','llm-start','llm-complete','tts-start','tts-first-audio'])assert.ok(events.some(e=>e.stage===stage));
  assert.equal(new Set(events.map(e=>e.turnId)).size,1);assert.ok(logs.some(e=>e.stage==='script-version'&&e.scriptCharacters===script.length));
  assert.ok(!JSON.stringify(logs).includes('private spoken fixture'));assert.ok(!JSON.stringify(logs).includes(script));g.close('owner',id);
});
test('STT timeout propagates distinctly and uncertain requests are not retried',async()=>{
  let requests=0;const s=createServices({stt:{protocol:'pcm16-json-text',url:'http://127.0.0.1:8788/transcribe'}},async()=>{requests++;throw new DOMException('fixture','TimeoutError');});
  await assert.rejects(s.stt(Buffer.alloc(640),new AbortController().signal),e=>e.name==='TimeoutError');assert.equal(requests,1);
});
test('explicit STT busy rejection can retry admission without overlapping accepted requests',async()=>{
  let requests=0;const s=createServices({stt:{protocol:'pcm16-json-text',url:'http://127.0.0.1:8788/transcribe'}},async()=>{requests++;return requests===1 ? new Response('{}',{status:429}) : Response.json({text:'hello'});});
  assert.equal(await s.stt(Buffer.alloc(640),new AbortController().signal),'hello');assert.equal(requests,2);
});
