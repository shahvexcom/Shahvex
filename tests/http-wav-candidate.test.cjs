const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {readNativeWav}=require('../gateway/experimental/http-wav-candidate.cjs');
const {createServices}=require('../gateway/services.cjs');const {Gateway}=require('../gateway/core.cjs');
function wave(){const w=Buffer.alloc(684);w.write('RIFF');w.writeUInt32LE(676,4);w.write('WAVEfmt ',8);w.writeUInt32LE(16,16);w.writeUInt16LE(1,20);w.writeUInt16LE(1,22);w.writeUInt32LE(16000,24);w.writeUInt32LE(32000,28);w.writeUInt16LE(2,32);w.writeUInt16LE(16,34);w.write('data',36);w.writeUInt32LE(640,40);return w;}
const config={agentName:'Jennifer',script:'Preserve full dynamic script.',campaignId:'fixture',voiceId:'fixture',direction:'inbound'};
async function server(handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {s,url:`http://127.0.0.1:${s.address().port}/synthesize`};}
function services(url){return createServices({tts:{protocol:'chatterbox-wav',url}},async(target,options)=>{const r=await readNativeWav(target,options);return new Response(r.body,{headers:r.headers});});}
test('candidate preserves accepted native drain, generation rejection, scripts/history and sequential requests',async()=>{
  let entered,release;const ready=new Promise(r=>{entered=r});let calls=0,active=0,peak=0;const wav=wave();
  const {s,url}=await server(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
    assert.equal(Number(req.headers['content-length']),body.length);assert.equal(typeof JSON.parse(body).text,'string');
    calls++;active++;peak=Math.max(peak,active);if(calls===1){entered();await new Promise(r=>{release=r});}
    res.writeHead(200,{'Content-Length':wav.length,'Content-Type':'audio/wav','Connection':'close'});res.end(wav);active--;
  });
  const g=new Gateway({...services(url),stt:async()=> 'synthetic question',llm:async()=> 'An approved synthetic reply.',voices:[{id:'fixture',verified:true}]});const id=g.create('owner',config);let played=0;
  try{
    const first=g.turn('owner',id,Buffer.alloc(640),16000,()=>assert.fail('Stale audio'));const cancelled=assert.rejects(first,e=>e.name==='AbortError');await ready;
    const second=g.turn('owner',id,Buffer.alloc(640),16000,()=>{played++});await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(g.queue.active,1);
    release();await cancelled;await second;assert.equal(calls,2);assert.equal(peak,1);assert.equal(played,1);assert.equal(g.owned('owner',id).history.length,2);assert.deepEqual(g.owned('owner',id).config,config);
  }finally{release?.();g.close('owner',id);s.closeAllConnections();await new Promise(r=>s.close(r));}
});
test('truncated response never plays PCM and the same session recovers on the next complete reply',async()=>{
  const wav=wave();let calls=0;
  const {s,url}=await server(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Length':wav.length,'Connection':'close'});res.end(++calls===1?wav.subarray(0,400):wav);});
  const g=new Gateway({...services(url),stt:async()=> 'question',llm:async()=> 'An approved synthetic reply.',voices:[{id:'fixture',verified:true}]});const id=g.create('owner',config);let played=0;
  try{
    await assert.rejects(g.turn('owner',id,Buffer.alloc(640),16000,()=>{played++}),e=>e.engineStage==='tts');assert.equal(played,0);assert.equal(g.owned('owner',id).history.length,0);
    await g.turn('owner',id,Buffer.alloc(640),16000,()=>{played++});assert.equal(played,1);assert.equal(g.owned('owner',id).history.length,2);
  }finally{g.close('owner',id);s.closeAllConnections();await new Promise(r=>s.close(r));}
});
test('candidate refuses remote destinations and missing bounded signal',()=>{
  assert.throws(()=>readNativeWav('https://example.com/wav',{signal:AbortSignal.timeout(1000)}),/Loopback/);
  assert.throws(()=>readNativeWav('http://127.0.0.1:1/wav'),/signal/);
});
