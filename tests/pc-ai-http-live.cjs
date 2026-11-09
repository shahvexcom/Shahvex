'use strict';
// Explicit opt-in live verification. Starts only new temporary loopback services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createTesterService } = require('../gateway/tester-service.cjs');
const { decodeWav, resample } = require('../gateway/wav.cjs');

async function main() {
  if (process.env.SHAHVEX_LIVE_PC_HTTP !== '1') throw Error('Set SHAHVEX_LIVE_PC_HTTP=1 to run live engines');
  const key = crypto.randomBytes(32).toString('hex');
  const {server} = createTesterService({secret:key});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8774,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:8774';
  async function call(path,body,extra={}) {
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-shahvex-ai-key':key,...extra},body,signal:AbortSignal.timeout(120000)});
    assert.equal(response.status,200,`HTTP ${response.status} on ${path}`);return response;
  }
  let id;
  const owner={'x-shahvex-owner':'http-verification','content-type':'application/json'};
  try {
    await (await call('/engine/8767/health')).arrayBuffer();
    assert.equal((await fetch(base+'/engine/8767/voices')).status,401);
    const voices=await (await call('/engine/8767/voices')).json();
    const voice=voices.voices.find(v=>v.selectable);assert.ok(voice);
    console.log('PASS authenticated voice inventory; anonymous request rejected');
    const preview=await call('/engine/8767/synthesize',JSON.stringify({text:'Hello. I would like to book a visit.',voice_id:voice.id}),{'content-type':'application/json'});
    const wav=Buffer.from(await preview.arrayBuffer());assert.equal(wav.subarray(0,4).toString(),'RIFF');
    console.log('PASS real voice preview WAV');
    const config={name:'Verification Agent',voice:voice.id,first:'customer',goal:'Help book visits',task:'Ask for a preferred day',instructions:'Reply in one short sentence.',script:'Visits are available Monday through Friday.',knowledge:'',style:'Professional'};
    id=(await (await call('/tester/start',JSON.stringify({agentId:'http-verification',config}),owner)).json()).id;assert.ok(id);
    const decoded=decodeWav(wav), pcm=resample(decoded.audio,decoded.sampleRate,16000);
    const input=Buffer.alloc(44+pcm.length);
    input.write('RIFF');input.writeUInt32LE(input.length-8,4);input.write('WAVEfmt ',8);input.writeUInt32LE(16,16);
    input.writeUInt16LE(1,20);input.writeUInt16LE(1,22);input.writeUInt32LE(16000,24);input.writeUInt32LE(32000,28);
    input.writeUInt16LE(2,32);input.writeUInt16LE(16,34);input.write('data',36);input.writeUInt32LE(pcm.length,40);pcm.copy(input,44);
    const turnHeaders={...owner,'x-shahvex-session':id,'x-shahvex-turn':'audio-one','content-type':'audio/wav'};
    const response=await call('/tester/turn',input,turnHeaders);
    const events=(await response.text()).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e=>e.type==='user'&&e.source==='stt'&&e.text),JSON.stringify(events.filter(e=>e.type!=='pcm')));
    assert.ok(events.some(e=>e.type==='pcm'&&Buffer.from(e.data,'base64').length));
    assert.ok(events.some(e=>e.type==='done'));
    assert.ok(!events.some(e=>e.type==='error'));
    console.log('PASS full HTTP chain: WAV → STT → Ollama → streamed PCM');
    const follow=await call('/tester/turn',JSON.stringify({text:'Which days are visits available?'}),{...owner,'x-shahvex-session':id,'x-shahvex-turn':'followup'});
    const followEvents=(await follow.text()).trim().split('\n').map(JSON.parse);
    assert.ok(followEvents.some(e=>e.type==='done')&&!followEvents.some(e=>e.type==='error'));
    console.log('PASS follow-up session through HTTP adapter');
    await call('/tester/interrupt','{}',{...owner,'x-shahvex-session':id});
    await call('/tester/stop','{}',{...owner,'x-shahvex-session':id});id=undefined;
    console.log('PASS interrupt/stop endpoints; temporary services shutting down');
  } finally {
    if(id)await call('/tester/stop','{}',{...owner,'x-shahvex-session':id}).catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
