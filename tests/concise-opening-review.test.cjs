'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {wrapConciseOpening,reviewServices,hash}=require('../gateway/concise-opening-review.cjs');
const {Gateway}=require('../gateway/core.cjs');
const script='Required exact disclosure: This is an automated assistant. Only explanatory phrasing is optional. Always preserve: Please confirm before proceeding.';
const policy={scriptSha256:hash(script),allowOptionalPhrasing:true,approvalReference:'synthetic-only'};
const messages=[{role:'system',content:'Baseline instructions.\nASSIGNED SCRIPT:\n'+script},{role:'assistant',content:'Existing conversation.'},{role:'user',content:'What next?'}];
test('default OFF returns original services/function; hosted and intelligence configurations cannot opt in',()=>{
  const fn=()=>{},base={llm:fn};assert.equal(wrapConciseOpening(fn),fn);assert.equal(reviewServices(base,{}),base);
  for(const extra of [{NODE_ENV:'production'},{VERCEL:'1'},{RAILWAY_PROJECT_ID:'x'},{SHAHVEX_AGENT_INTELLIGENCE:'1'}])assert.throws(()=>reviewServices(base,{SHAHVEX_CONCISE_OPENING_REVIEW:'1',...extra}));
});
test('unapproved, edited and unrelated scripts receive byte-identical baseline messages',async()=>{
  const seen=[];const fn=wrapConciseOpening(async m=>{seen.push(m);return 'Baseline.';},{enabled:true,approvedScripts:[policy]});
  for(const text of [script+' Changed.','Unrelated campaign.']){const m=[{...messages[0],content:'Baseline instructions.\nASSIGNED SCRIPT:\n'+text},...messages.slice(1)];await fn(m,new AbortController().signal);assert.equal(seen.at(-1),m);}
});
test('approval must be explicit; no inferred optional permissions or request-provided override',()=>{
  for(const p of [{...policy,allowOptionalPhrasing:false},{...policy,approvalReference:''},{...policy,scriptSha256:'bad'},{...policy,unknown:true}])assert.throws(()=>wrapConciseOpening(()=>{},{enabled:true,approvedScripts:[p]}));
});
test('approved script/history are immutable; one request; original deltas and final output preserved',async()=>{
  let count=0,seen;const fn=wrapConciseOpening(async(m,_s,_t,delta)=>{count++;seen=m;delta('The next step is straightforward.');return 'The next step is straightforward.';},{enabled:true,approvedScripts:[policy]});
  const original=JSON.stringify(messages);let chunks='';const result=await fn(messages,new AbortController().signal,()=>{},d=>chunks+=d);
  assert.equal(count,1);assert.equal(result,chunks);assert.equal(JSON.stringify(messages),original);assert.ok(seen[0].content.endsWith('\nASSIGNED SCRIPT:\n'+script));assert.deepEqual(seen.slice(1),messages.slice(1));assert.ok(seen[0].content.includes('Keep any required opening first even if long'));
});
test('first PCM before full LLM completion, exact history, sequential TTS and cancellation survive wrapper',async()=>{
  let release,started;const eof=new Promise(r=>release=r),firstTts=new Promise(r=>started=r);let concurrent=0,max=0;
  const llm=wrapConciseOpening(async(_m,signal,_t,delta)=>{delta('A short complete substantive answer. ');await eof;signal.throwIfAborted();delta('The required follow-up is preserved.');return 'A short complete substantive answer. The required follow-up is preserved.';},{enabled:true,approvedScripts:[policy]});
  const gateway=new Gateway({stt:async()=> 'What next?',llm,tts:async()=>{concurrent++;max=Math.max(max,concurrent);started();concurrent--;return Buffer.alloc(640);},voices:[{id:'synthetic',verified:true}]});
  const config={campaignId:'synthetic',voiceId:'synthetic',direction:'inbound',script};const id=gateway.create('owner',config);
  try{const turn=gateway.turn('owner',id,Buffer.alloc(640));await firstTts;release();const r=await turn;assert.ok(r.reply.endsWith('preserved.'));assert.equal(max,1);assert.equal(gateway.owned('owner',id).history.length,2);}finally{release();gateway.close('owner',id);}
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(llm(messages,cancelled.signal,()=>{},()=>{}));
});
