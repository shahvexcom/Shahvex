const {test}=require('node:test');const assert=require('node:assert/strict');
const {createServer}=require('../gateway/server.cjs');const {backendClient}=require('../gateway/backend-client.cjs');const {textChunks}=require('../gateway/text-chunks.cjs');
const config={agentName:'Jennifer',campaignId:'multiturn-fixture',direction:'inbound',voiceId:'fixture',script:'Disclose automation. Answer the approved service questions accurately.'};
const pcm=Buffer.alloc(6400);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(2000,i);
const utterance=Buffer.concat([pcm,Buffer.alloc(12800)]);
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture event timed out');};
test('ten real-time turns on one HTTP stream: context, interruption, recovery and cleanup', {timeout:10000},async()=>{
  const events=[],messages=[];let stt=0,tts=0,aborts=0;const token='multi-turn-private-fixture-'.repeat(3);
  const server=createServer({token,logger:()=>{},services:{voices:[{id:'fixture',verified:true}],health:async()=>({ready:true}),
    stt:async()=>`question-${++stt}`,llm:async m=>{messages.push(structuredClone(m));return `answer-${messages.length}`;},
    tts:async function*(_text,_voice,signal){const n=++tts;yield Buffer.alloc(640,n);if(n===4)await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Error('fixture native abort'));},{once:true}));yield Buffer.alloc(640,n);},
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const client=backendClient({baseUrl,token});let session,stream;
  try{
    session=await client.create(config);stream=client.stream(session,e=>events.push(e));
    const done=stream.done.catch(e=>e);
    for(let n=1;n<=3;n++){stream.request.write(utterance);await wait(()=>events.filter(e=>e.type==='turn-end').length===n);}
    stream.request.write(utterance);await wait(()=>tts===4&&events.some(e=>e.type==='audio'&&Buffer.from(e.pcm,'base64')[0]===4));
    stream.request.write(utterance);await wait(()=>events.filter(e=>e.type==='turn-end').length===4);
    for(let n=6;n<=10;n++){stream.request.write(utterance);await wait(()=>events.filter(e=>e.type==='turn-end').length===n-1);}
    stream.request.end();await done;
    assert.equal(stt,10);assert.equal(tts,10);assert.equal(aborts,1);assert.equal(events.filter(e=>e.type==='turn-error').length,0);
    assert.equal(events.filter(e=>e.type==='cancelled').length,1);
    assert.equal(messages[4].filter(m=>m.role==='assistant').length,3);assert.ok(!JSON.stringify(messages[4]).includes('answer-4'));
    assert.match(messages[4][0].content,/Jennifer/);assert.ok(messages[4][0].content.endsWith(config.script));
    assert.equal(messages[4].at(-1).content,'question-5');
    const clears=events.map((e,i)=>e.type==='clear'?i:-1).filter(i=>i>=0),cut=clears.at(-1);
    assert.ok(events.slice(cut).filter(e=>e.type==='audio').every(e=>Buffer.from(e.pcm,'base64')[0]===10));
    await client.close(session);session=null;
    const health=await(await fetch(`${baseUrl}/health`,{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(health.activeSessions,0);await wait(()=>health.queue.pending===0);
  }finally{stream?.request.destroy();if(session)await client.close(session);server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Chatterbox chunking respects 350-character installed limit without changing word order',()=>{
  const text=('Mandatory disclosure stays intact. Please explain the service accurately. ').repeat(14).trim();
  const parts=textChunks(text);assert.ok(parts.length>1);assert.ok(parts.every(p=>p.length<=300));assert.equal(parts.join(' '),text);
});
