'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {reviewServices,launch}=require('../gateway/groq-voice-review.cjs');
const {Gateway}=require(process.env.SHAHVEX_REVIEW_TEST_ROOT?require('node:path').join(process.env.SHAHVEX_REVIEW_TEST_ROOT,'core.cjs'):'../gateway/core.cjs');
function fixture(){const old={stt:async()=>'',tts:async()=>Buffer.alloc(640),llm:async()=>'',health:async()=>({ready:true}),voices:[{id:'fixture',verified:true}]};return old;}
const env={SHAHVEX_GROQ_VOICE_REVIEW:'1',GROQ_API_KEY:'fixture-only'};
const event=choice=>`data: ${JSON.stringify({choices:[{index:0,...choice}]})}\n\n`;
const response=(text,finish='stop')=>new Response(event({delta:{content:text},finish_reason:null})+event({delta:{},finish_reason:finish})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
test('review is default-OFF, hosted-blocked and never silently enables Agent Intelligence',()=>{
  const original=fixture();assert.equal(reviewServices(original,{}),original);assert.throws(()=>launch({}),/OFF/);
  for(const hosted of [{NODE_ENV:'production'},{VERCEL:'1'},{RAILWAY_PROJECT_ID:'x'}])assert.throws(()=>reviewServices(original,{...env,...hosted}));
  assert.throws(()=>launch({...env,SHAHVEX_AGENT_INTELLIGENCE:'1'}),/Intelligence/);
});
test('only LLM is replaced; dynamic script/history are unchanged; token/queue timing is metadata-only',async()=>{
  const old=fixture(),messages=[{role:'system',content:'Synthetic required script A.'},{role:'user',content:'A follow-up question.'}];let called=0;
  const services=reviewServices(old,env,async(_u,o)=>{called++;const body=JSON.parse(o.body);assert.deepEqual(body.messages,messages);assert.equal(body.max_completion_tokens,256);assert.equal(body.model,'openai/gpt-oss-20b');return response('A contextual synthetic reply.');});
  for(const key of ['stt','tts','voices','health'])assert.equal(services[key],old[key]);let deltas='',timings=[];
  const text=await services.llm(messages,new AbortController().signal,(stage,data)=>timings.push({stage,data}),d=>deltas+=d);assert.equal(text,deltas);assert.equal(called,1);assert.ok(timings.some(t=>t.stage==='llm-first-token'));assert.ok(!JSON.stringify(timings).includes('fixture-only'));
});
test('incremental Groq phrase reaches mocked TTS before cloud EOF and preserves exact text',async()=>{
  let release,started;const eof=new Promise(r=>release=r),ttsStarted=new Promise(r=>started=r);const first='A complete meaningful opening sentence. ';
  const services=reviewServices({...fixture(),stt:async()=> 'Explain the topic.',tts:async()=>{started();return Buffer.alloc(640);}},env,async()=>new Response(new ReadableStream({async start(c){c.enqueue(new TextEncoder().encode(event({delta:{content:first},finish_reason:null})));await eof;c.enqueue(new TextEncoder().encode(event({delta:{content:'The ordered follow-up remains intact.'},finish_reason:null})+event({delta:{},finish_reason:'stop'})+'data: [DONE]\n\n'));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
  const g=new Gateway({...services,intelligence:null});const id=g.create('owner',{agentName:'Synthetic',campaignId:'unrelated',voiceId:'fixture',direction:'inbound',script:'Keep the supplied synthetic wording.'});
  try{const turn=g.turn('owner',id,Buffer.alloc(640));await ttsStarted;release();const r=await turn;assert.equal(r.reply,first+'The ordered follow-up remains intact.');}finally{release();g.close('owner',id);}
});
test('length failure cannot commit completed history and never falls back to Ollama',async()=>{
  let baselineCalls=0;const old={...fixture(),stt:async()=> 'Explain the topic.',llm:async()=>{baselineCalls++;}};
  const services=reviewServices(old,env,async()=>response('A partial answer that ends without completing the required thought. ','length'));
  const g=new Gateway({...services,intelligence:null});const id=g.create('owner',{campaignId:'test',voiceId:'fixture',direction:'inbound',script:'Do not invent facts.'});
  try{await assert.rejects(g.turn('owner',id,Buffer.alloc(640)));assert.equal(g.owned('owner',id).history.length,0);assert.equal(baselineCalls,0);}finally{g.close('owner',id);}
});
