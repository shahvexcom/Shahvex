'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectIntent,prepareStyleRequest}=require('../gateway/dialogue-style.cjs');
const {scenarios,request,locked,auditExample}=require('../gateway/style-review/scenarios.cjs');
const {loadOfflineGateway,proposedSource}=require('../gateway/style-review/proposed-core.cjs');
const {evaluate}=require('../gateway/style-review/evaluate.cjs');
const {Gateway}=loadOfflineGateway();
const config={agentName:'Jennifer',voiceId:'fixture',script:'Exact mandatory wording. Dynamic test script remains authoritative.',campaignId:'offline',direction:'inbound'};
test('four conservative intents, immediate context and uncertain/negated language',()=>{
  for(const s of scenarios)assert.equal(selectIntent(s.customer,s.history,s.policy).intent,s.intent);
  for(const text of ['I am not worried.','I sound sad apparently.','Make your intent warm.','What is the price?','Do not repeat that.'])assert.equal(selectIntent(text).intent,'neutral');
  assert.equal(selectIntent('Okay.',[{role:'user',content:'I am confused.'},{role:'assistant',content:'Details?'},{role:'user',content:'How long?'}]).intent,'neutral');
  assert.equal(selectIntent('I\u2019m confused.').intent,'reassuring');
  assert.equal(selectIntent('I am worried.',[],{responseIntent:'consent'}).intent,'serious');
});
test('trusted default-deny policy, reserved flows and bounded input',()=>{
  const m=request(scenarios[0]);assert.strictEqual(prepareStyleRequest(m).messages,m);
  assert.strictEqual(prepareStyleRequest(m,{allowOptionalPhrasing:false}).messages,m);
  for(const text of ['Stop calling me.','Do not call.','Remove my number.','I do not consent.']){
    const input=[m[0],{role:'user',content:text}];const r=prepareStyleRequest(input,{allowOptionalPhrasing:true});
    assert.equal(r.decision.intent,'serious');assert.equal(r.decision.applied,false);assert.strictEqual(r.messages,input);
  }
  assert.equal(prepareStyleRequest(m,{allowOptionalPhrasing:true,flowAction:'transfer'}).decision.applied,false);
  assert.throws(()=>selectIntent('x'.repeat(8001)),/Bounded/);assert.throws(()=>prepareStyleRequest([]),/request/);
});
test('system/script bytes, history, facts and customer remain unchanged; intent is response-stable',()=>{
  for(const s of scenarios){const m=request(s),before=structuredClone(m);const r=prepareStyleRequest(m,{allowOptionalPhrasing:true,...s.policy});
    assert.deepEqual(m,before);assert.ok(r.messages[0].content.startsWith(m[0].content));
    assert.deepEqual(r.messages.slice(1),m.slice(1));assert.ok(Object.isFrozen(r.decision));
    assert.equal((r.messages[0].content.match(/OPTIONAL DELIVERY ONLY:/g)||[]).length,1);
    for(const required of locked)assert.ok(r.messages[0].content.includes(required));
    assert.ok(!/\[(?:laugh|sigh)\]|<prosody|speed=|exaggeration=/.test(r.messages[0].content));
  }
});
test('authored naturalness guardrails preserve fixture wording/order; reject changed facts, disclosures and promises',()=>{
  for(const s of scenarios){assert.ok(auditExample(s,s.baseline));assert.ok(auditExample(s,s.styled));
    assert.ok(!auditExample(s,s.styled.replace('20 minutes','10 minutes')));
    assert.ok(!auditExample(s,s.styled.replace(locked[0],'')));
    assert.ok(!auditExample(s,s.styled+' You are guaranteed approval.'));
    assert.ok(!/\[|<|certainly certainly|I am thinking/i.test(s.opening));
  }
});
test('in-memory integration: single streaming call, early audio, sequential synthesis and multi-turn history',{timeout:3000},async()=>{
  let calls=0,done=false,release,active=0,peak=0;const prompts=[],spoken=[],audio=[];
  const first='I am Jennifer, your automated Shahvex assistant.',tail=' The sample appointment lasts 20 minutes. May I continue?';
  const g=new Gateway({voices:[{id:'fixture',verified:true}],stylePolicy:()=>({allowOptionalPhrasing:true}),
    stt:async()=>calls?'Can you explain?':'Hello.',
    llm:async(messages,signal,timing,delta)=>{calls++;prompts.push(messages);assert.equal(signal.aborted,false);assert.equal(typeof timing,'function');delta(first+' ');await new Promise(r=>{release=r});delta(tail.trimStart());done=true;return first+tail;},
    tts:async text=>{active++;peak=Math.max(peak,active);spoken.push(text);await new Promise(r=>setImmediate(r));active--;return Buffer.alloc(640);}});
  const id=g.create('owner',config);
  try{for(let turn=0;turn<2;turn++){done=false;await g.turn('owner',id,Buffer.alloc(640),16000,chunk=>{audio.push(chunk);if(!done){assert.ok(release);release();}});}
    assert.equal(calls,2);assert.equal(prompts[1].length,4);assert.equal(g.owned('owner',id).history.length,4);
    assert.equal(prompts[1][1].content,'Hello.');assert.equal(prompts[1][2].content,first+tail);
    assert.ok(prompts.every(m=>m[0].content.includes(config.script)));
    assert.ok(prompts[0][0].content.includes('friendly'));assert.ok(prompts[1][0].content.includes('calmly'));
    assert.equal(spoken.slice(0,3).join(' '),first+tail);assert.equal(spoken.slice(3).join(' '),first+tail);assert.equal(audio.length,6);assert.equal(peak,1);
  }finally{g.close('owner',id);}
});
test('session intent/history isolation and scripts with no permitted flexibility',async()=>{
  let current='Hello.';const prompts=[];
  const g=new Gateway({maxSessions:2,voices:[{id:'fixture',verified:true}],stylePolicy:c=>({allowOptionalPhrasing:c.campaignId==='offline'}),
    stt:async()=>current,llm:async m=>{prompts.push(m);return 'A complete mandatory response.';},tts:async()=>Buffer.alloc(640)});
  const a=g.create('a',config),b=g.create('b',{...config,campaignId:'verbatim',script:'Say exactly: A complete mandatory response.'});
  try{await g.turn('a',a,Buffer.alloc(640));current='I am confused.';await g.turn('b',b,Buffer.alloc(640));
    assert.ok(prompts[0][0].content.includes('friendly'));assert.ok(!prompts[1][0].content.includes('OPTIONAL DELIVERY ONLY'));
    assert.equal(prompts[1].length,2);assert.equal(g.owned('a',a).history[0].content,'Hello.');assert.equal(g.owned('b',b).history[0].content,'I am confused.');
    assert.throws(()=>g.owned('a',b),/unavailable/);
  }finally{g.close('a',a);g.close('b',b);}
});
test('in-memory integration: cancellation rejects stale audio and does not commit history',{timeout:3000},async()=>{
  let entered,release,played=0;const ready=new Promise(r=>{entered=r});
  const g=new Gateway({voices:[{id:'fixture',verified:true}],stylePolicy:()=>({allowOptionalPhrasing:true}),stt:async()=> 'Hello.',
    llm:async(m,s,t,delta)=>{const text='I am Jennifer, an automated assistant.';delta(text);return text;},
    tts:async()=>{entered();await new Promise(r=>{release=r});return Buffer.alloc(640);}});
  const id=g.create('owner',config);const turn=g.turn('owner',id,Buffer.alloc(640),16000,()=>played++);
  const rejected=assert.rejects(turn,e=>e.name==='AbortError');await ready;g.interrupt('owner',id);release();await rejected;
  assert.equal(played,0);assert.equal(g.owned('owner',id).history.length,0);g.close('owner',id);
});
test('proposal fails closed on source drift; unconfigured Gateway has byte-identical prompt',async()=>{
  assert.throws(()=>proposedSource('unexpected source'),/review/);
  const captured=[];const g=new Gateway({voices:[{id:'fixture',verified:true}],stt:async()=> 'Hi.',
    llm:async m=>{captured.push(m);return 'A complete response.';},tts:async()=>Buffer.alloc(640)});
  const id=g.create('owner',config);try{await g.turn('owner',id,Buffer.alloc(640));assert.ok(captured[0][0].content.endsWith(config.script));assert.ok(!captured[0][0].content.includes('OPTIONAL DELIVERY ONLY'));}finally{g.close('owner',id);}
});
test('offline paired evaluation has 30 future trials and measurable controller-only overhead',()=>{
  const r=evaluate();assert.equal(r.pairs.length,5);assert.ok(r.pairs.every(p=>p.intent===p.expectedIntent&&p.fixtureContentAudit&&p.originalPromptPreserved));
  assert.equal(r.randomizedFutureTrialPlan.length,30);assert.equal(r.firstAudibleLatency,null);assert.equal(r.perceivedNaturalness,null);
  assert.ok(Number.isFinite(r.controllerCpuMilliseconds.p95));
});
