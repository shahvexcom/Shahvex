const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {transferConsent}=require('../gateway/handoff-intent.cjs');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,limit=4000){const end=Date.now()+limit;while(!f()){if(Date.now()>end)throw Error('Timed out');await wait(10);}}
const q1='Are you getting any money back on a card each month?',q2='Do you have Medicare Part A or Part B or Medicaid?',q3='Are you between 60 and 80 years old?';
const config={name:'Lauren',voice:'v9-fixture',first:'customer',goal:'Discuss coverage review',task:'Ask the configured questions',instructions:'',script:'Hi, this is Lauren from Wellness Team. I am calling to discuss a coverage review.\n'+q1+'\n'+q2+'\n'+q3+'\nLet me connect you with a licensed specialist.',knowledge:'',style:'Natural'};
function fixture({tts, stt}={}){
 const original=global.fetch,secret='v9-fixture-'.repeat(4);let models=0,recognitions=0,id;
 global.fetch=async (url,init)=>{
  if(String(url).includes('11434')){models++;return new Response(JSON.stringify({message:{content:'A licensed specialist reviews the details. '+q2},done:true})+'\n');}
  if(String(url).includes('8766')){recognitions++;return Response.json({text:stt?.() ?? 'Hello'});}
  if (tts) return tts(url,init);
  return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body,headers={})=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v9-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json',...headers},body:body instanceof Buffer?body:JSON.stringify(body)});
 const dispatch=(action,body,headers)=>service.dispatch(request(action,body,headers));
 const turn=async (body,{ack=true}={})=>{const r=await dispatch('turn',body);assert.equal(r.status,200);const events=(await r.text()).trim().split('\n').filter(Boolean).map(JSON.parse);assert.deepEqual(events.filter(e=>e.type==='error'),[]);if(ack&&events.some(e=>e.type==='pcm'))await dispatch('playback-complete',{completedTurnId:events.find(e=>e.type==='done')?.turnId});return {text:events.filter(e=>e.type==='delta').map(e=>e.text).join(''),id:events.find(e=>e.type==='done')?.turnId,events};};
 return {service,dispatch,turn,async start(first='customer',overrides={}){id=(await(await dispatch('start',{agentId:'v9-agent',requirePlaybackAck:true,config:{...config,first,...overrides}})).json()).id;return service.sessionStore.get(id);},async close(){if(id)await dispatch('stop',{});global.fetch=original;},get models(){return models;},get recognitions(){return recognitions;}};
}
test('customer-first is silent, hello starts/restarts the full intro, then goal and one question per acknowledgment without model calls',async()=>{
 const f=fixture();try{
 const session=await f.start();
 assert.equal((await f.turn({opening:true})).text,'');assert.equal(session.messages.filter(m=>m.role==='assistant').length,0);
 let t=await f.turn({text:'Hello, who are you and why are you calling?'},{ack:false});assert.match(t.text,/Lauren.*Wellness Team.*How are you/s);assert.doesNotMatch(t.text,/listening|still there|calling to/);
 await f.dispatch('interrupt',{});t=await f.turn({text:'Hello'},{ack:false});assert.equal(t.text,'Hi, this is Lauren from Wellness Team. How are you doing today?');
 await f.dispatch('interrupt',{});t=await f.turn({text:'Hello hello'});assert.match(t.text,/^Hi, this is Lauren.*How are you doing today\?/);
 await f.dispatch('playback-complete',{completedTurnId:t.id});
 t=await f.turn({text:'Okay'});assert.match(t.text,/calling to discuss a coverage review/);assert.doesNotMatch(t.text,/money back|Medicare Part/);
 t=await f.turn({text:'Yep'});assert.equal(t.text,q1);
 assert.equal((await f.turn({silenceStep:1})).text,'','silence cannot automatically repeat the question');
 t=await f.turn({text:'Okay'});assert.equal(t.text,q2);
 t=await f.turn({text:'Hmm'});assert.equal(t.text,q3);
 t=await f.turn({text:'Yes'});assert.equal(t.text,'Let me connect you with a licensed specialist.');assert.doesNotMatch(t.text,/would you like|shall I|may I/i);
 const accepted=await f.turn({text:'mm-hmm'});assert.equal(accepted.text,'');assert(!accepted.events.some(e=>e.type==='pcm'));assert.equal(transferConsent(session.messages),true);
 for(const q of [q1,q2,q3])assert.equal(session.messages.filter(m=>m.role==='assistant'&&m.content===q).length,1,q);
 assert.equal(f.models,0,'routine intro, purpose and script progression must not wait for an LLM');
 }finally{await f.close();}
});
test('agent-first speaks once; identity/health questions resume the interrupted question and presence is consumed',async()=>{
 const f=fixture();try{
 const session=await f.start('ai');let t=await f.turn({opening:true});assert.match(t.text,/Lauren.*Wellness Team/);await f.dispatch('playback-complete',{completedTurnId:t.id});
 await f.turn({text:'Okay'});await f.turn({text:'Yes'});
 t=await f.turn({text:'Who are you?'});assert.match(t.text,/Lauren.*Wellness Team.*money back/s);
 await f.turn({text:'No'});t=await f.turn({text:'Are you drunk?'});assert.match(t.text,/don't drink alcohol.*Medicare Part A/s);
 await f.turn({silenceStep:2});t=await f.turn({text:'Yes, I am here.'});assert.equal(session.hearingConfirmed,true);assert.match(t.text,/Medicare Part A/);assert.doesNotMatch(t.text,/can you hear|still there|last point|listening/i);
 }finally{await f.close();}
});
test('final listen does one recognition and no semantic LLM classification',async()=>{
 const f=fixture();try{await f.start();const audio=Buffer.alloc(16044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);for(let i=44;i<audio.length;i+=2)audio.writeInt16LE(2200,i);
 const r=await f.dispatch('listen',audio,{'content-type':'audio/wav','x-shahvex-turn-final':'1'});assert.equal(r.status,200);assert.equal((await r.json()).completion,'complete');assert.equal(f.recognitions,1);assert.equal(f.models,0);
 }finally{await f.close();}
});
test('native customer-first waits; 350ms boundary uses one STT pass and plays first PCM before synthesis completes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v9-stream-'));let socket,release,streamOpen=false,bytes=0,probes=0,opening=0,turns=0,interrupts=0,lastVoice=0,probeAt=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'v9-stream-fixture-'.repeat(4),spoolDir:dir,endOfSpeechMs:1000,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_u,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer',mediaReady:true});
 if(e.action==='interrupt'){interrupts++;return Response.json({interrupted:true});}
 if(e.action==='listen'){probes++;probeAt=Date.now();return Response.json({text:'Hello',completion:'incomplete'});}
 if(e.action==='turn'){
  if(e.opening)opening++;else turns++;
  return new Response(new ReadableStream({start(controller){streamOpen=true;controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(48000,4).toString('base64')})+'\n'));release=()=>{if(!streamOpen)return;streamOpen=false;try{controller.enqueue(new TextEncoder().encode('{"type":"done","turnId":"v9-stream"}\n'));controller.close();}catch{}};init.signal.addEventListener('abort',release,{once:true});}}));
 }
 return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',v=>bytes+=v.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(650);assert.equal(opening,0);assert.equal(bytes,0);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);
 const phrase=Buffer.concat(Array.from({length:10},()=>packet(0x10,voice)));socket.write(phrase);await wait(220);socket.write(phrase);lastVoice=Date.now();await until(()=>bytes>0,2200);
 assert.equal(probes,1);assert.equal(turns,1);assert.equal(streamOpen,true,'first audio must not wait for the SSE/TTS stream to close');assert(probeAt-lastVoice<650,'legacy 1-second pause must not delay the boundary');assert(Date.now()-lastVoice<1400,'fixture transport must respond without an artificial multi-second hold');
 socket.write(phrase);await until(()=>turns===2,1600);assert.equal(probes,2);assert.equal(interrupts,1,'a new Hello must interrupt while the previous synthesis stream is still open');
 }finally{release?.();socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});

test('intro wellbeing replies include courtesy plus calling purpose before screening, with or without an in-flight playback acknowledgment',async()=>{
 const {isWellbeingReply}=require('../gateway/conversation-resume.cjs');
 for(const phrase of ["I'm good, and you?",'How about you?',"I'm fine, thanks. And you?",'Good, thank you. How are you doing today?',"I’m doing well, how about yourself?",'Fine.']){
  assert.equal(isWellbeingReply(phrase),true,phrase);
  for(const ack of [true,false]){
   const f=fixture();try{
    const session=await f.start();const intro=await f.turn({text:'Hello'},{ack:false});
    if(ack)await f.dispatch('playback-complete',{completedTurnId:intro.id});
    else await f.dispatch('interrupt',{}); // Native speech may overtake the playback acknowledgment.
    const purpose=await f.turn({text:phrase},{ack:false});assert.match(purpose.text,/calling to discuss a coverage review/);assert.doesNotMatch(purpose.text,/money back|Medicare Part/);assert.notEqual(session.purposeDelivered,true);await f.dispatch('playback-complete',{completedTurnId:purpose.id});assert.equal(session.purposeDelivered,true);
    if(/and you|how about|how are you/i.test(phrase))assert.match(purpose.text,/doing well.*calling/s);
    const next=await f.turn({text:'Okay'});assert.equal(next.text,q1);assert.doesNotMatch(next.text,/calling|doing well/);assert.equal(f.models,0);
   }finally{await f.close();}
  }
 }
 for(const text of ['Who are you?','Why are you calling?','I have Medicaid.','No, stop calling me.','Hello'])assert.equal(isWellbeingReply(text),false,text);
});

test('filler-prefixed wellbeing gets Great/address and actual purpose; every business question remains in script order across Yes/No branches',async()=>{
 const purpose='I am calling because we are reviewing the coverage options in this campaign.';
 const script='Hi, this is Lauren from Wellness Team. How are you doing today? '+purpose+'\n'+q1+'\nIf customer says yes\nThank you.\nIf customer says no\n'+q2+'\nWhatever customer answers\n'+q3+'\nLet me connect you with a licensed specialist.';
 const {scriptQuestionProgress}=require('../gateway/reply-integrity.cjs');
 // Other consumers retain their explicit branch policy; this voice flow requests all questions.
 const memory={completed:[{question:q1,response:'Yes'}]};
 assert.equal(scriptQuestionProgress(script,memory).find(x=>x.question===q2).applicability,'not_applicable');
 assert.equal(scriptQuestionProgress(script,memory,{includeBranchQuestions:true}).find(x=>x.question===q2).applicability,'required');
 assert(!scriptQuestionProgress(script,{completed:[]},{includeBranchQuestions:true}).some(x=>/doing today/.test(x.question)));
 for(const [social,rebate] of [["Uh, I'm good.",'Yes'],['Um, I am good.','No'],["Umm, I'm good, and you?",'Okay']]){
  const f=fixture();try{
   const session=await f.start('customer',{script});const intro=await f.turn({text:'Hello'});assert.match(intro.text,/How are you doing today\?$/);await f.dispatch('playback-complete',{completedTurnId:intro.id});
   const goal=await f.turn({text:social});assert.match(goal.text,/Sir, I am calling because/);assert.doesNotMatch(goal.text,/money back|Medicare Part|between 60/);
   if(!/and you/.test(social))assert.match(goal.text,/^Great, Sir,/);
   assert.equal((await f.turn({text:'Yes'})).text,q1);
   assert.equal((await f.turn({text:rebate})).text,q2,'coverage question must be asked after every acknowledged rebate response');
   assert.equal((await f.turn({text:'I have Medicaid.'})).text,q3);
   assert.equal((await f.turn({text:'Yes'})).text,'Let me connect you with a licensed specialist.');
   for(const q of [q1,q2,q3])assert.equal(session.messages.filter(m=>m.role==='assistant'&&m.content===q).length,1,q);
   assert.equal(f.models,0);
  }finally{await f.close();}
 }
});

const pcmHeaders = {'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'};
const sourcePcm = (sample, ms) => {
 const pcm = Buffer.alloc(48 * ms);
 for (let i=0;i<pcm.length;i+=2) pcm.writeInt16LE(sample,i);
 return pcm;
};
test('shared handler and bridge drain each sentence before delivering purpose or advancing screening', {timeout:65000}, async()=>{
 const realConfig=process.env.SHAHVEX_REC414_TEST_CONFIG;
 const realFetch=global.fetch;
 const originalTempo=process.env.SHAHVEX_SPEECH_TEMPO;
 if(!realConfig)process.env.SHAHVEX_SPEECH_TEMPO='1';
 const ttsCalls=[], events=[], frames=[];
 let spoken='Hello', releasePurpose, openingSecond=false, wellbeingRequests=0, holdOpening=!realConfig, holdPurpose=!realConfig, socket, received=Buffer.alloc(0);
 const f=fixture({stt:()=>spoken,tts:async(url,init)=>{
  const {text}=JSON.parse(init.body);
  const call={text,bytes:0};ttsCalls.push(call);
  if(realConfig){
   const response=await realFetch(url,init);
   return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){call.bytes+=chunk.length;controller.enqueue(chunk);}})),{status:response.status,headers:response.headers});
  }
  if(holdOpening&&/How are you doing today/i.test(text)){
   if(++wellbeingRequests===1)return new Response(Buffer.alloc(0),{headers:pcmHeaders});
   holdOpening=false;openingSecond=true;
   const pcm=sourcePcm(520,240);call.bytes=pcm.length;
   return new Response(new ReadableStream({start(controller){
    controller.enqueue(pcm);
    init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});
   }}),{headers:pcmHeaders});
  }
  if(holdPurpose&&/calling to discuss/i.test(text)){
   holdPurpose=false;
   await new Promise(resolve=>releasePurpose=resolve);
   init.signal.throwIfAborted();
  }
  const pcm=sourcePcm(/doing well/i.test(text)?730:/calling/i.test(text)?910:390,120);
  call.bytes=pcm.length;
  return new Response(pcm,{headers:pcmHeaders});
 }});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rec414-loopback-'));
 const bridge=createBridge({
  siteUrl:'https://fixture.invalid',connectionId:crypto.randomUUID(),secret:'rec414-loopback-fixture-'.repeat(4),spoolDir:dir,
  testOnly:true,allowUnregisteredManualAudio:true,logger:message=>{if(process.env.SHAHVEX_REC414_TEST_DEBUG)console.log(message);},
  fetchImpl:async(_url,init)=>{
   const e=JSON.parse(init.body);events.push(e);
   if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'ai',mediaReady:true});
   if(['turn','listen','interrupt','playback-complete'].includes(e.action)){
    return f.dispatch(e.action,e.audio?Buffer.from(e.audio,'base64'):e,{
     'content-type':e.audio?'audio/wav':'application/json','x-shahvex-turn':e.eventId,
     'x-shahvex-completed-turn':e.completedTurnId||'',
    });
   }
   return Response.json({saved:true});
  },
 });
 const say=async text=>{
  spoken=text;
  socket.write(Buffer.concat([
   ...Array.from({length:10},()=>packet(0x10,sourcePcm(2400,20).subarray(0,320))),
   ...Array.from({length:19},()=>packet(0x10,Buffer.alloc(320))),
  ]));
  await until(()=>events.some(e=>e.action==='listen'&&!e.seen));
  events.findLast(e=>e.action==='listen').seen=true;
 };
 try{
  const session=await f.start('ai',realConfig?{...JSON.parse(fs.readFileSync(realConfig)),first:'ai'}:{voice:'rec414-fixture-'+crypto.randomUUID()});
  await new Promise((resolve,reject)=>{bridge.audio.once('error',reject);bridge.audio.listen(0,'127.0.0.1',resolve);});
  socket=net.connect(bridge.audio.address().port,'127.0.0.1');
  socket.on('data',chunk=>{
   received=Buffer.concat([received,chunk]);
   while(received.length>=3&&received.length>=3+received.readUInt16BE(1)){
    const end=3+received.readUInt16BE(1);
    if(received[0]===0x10) frames.push(Buffer.from(received.subarray(3,end)));
    received=received.subarray(end);
   }
  });
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(packet(1,crypto.randomBytes(16)));
  if(!realConfig){
   await until(()=>openingSecond&&frames.some(frame=>frame.readInt16LE(100)===520));
   await say('Hello');
   await until(()=>session.introPlaybackComplete);
   assert.equal(events.filter(e=>e.action==='interrupt').length,1);
   const initial=events.find(e=>e.action==='turn').eventId;
   assert(!events.some(e=>e.action==='playback-complete'&&e.completedTurnId===initial));
  }else{
   await until(()=>session.introPlaybackComplete,14000);
  }
  assert.match(session.messages.findLast(m=>m.role==='assistant').content,/How are you doing today\?$/);
  const firstPurposeFrame=frames.length;
  await say("I'm good, and you?");
  if(!realConfig){
   await until(()=>releasePurpose&&frames.some(frame=>frame.readInt16LE(100)===730));
   const intro=events.findLast(e=>e.action==='playback-complete').completedTurnId;
   await f.dispatch('playback-complete',{completedTurnId:intro});
   assert.notEqual(session.purposeDelivered,true);
   // Unrecognized overlap preserves both queued and still-synthesizing audio.
   await say('');
   await wait(3200);
   assert(!events.some(e=>e.silenceStep));
   assert.equal(events.filter(e=>e.action==='interrupt').length,1);
   await say('Hello');
   await until(()=>events.filter(e=>e.action==='interrupt').length===2);
   releasePurpose();
   assert.notEqual(session.purposeDelivered,true);
  }
  await until(()=>session.purposeDelivered,32000);
  const purposeFrames=frames.slice(firstPurposeFrame);
  assert(purposeFrames.some(frame=>frame.some(Boolean)));
  assert.match(session.messages.findLast(m=>m.role==='assistant').content,/doing well.*calling.*May I ask/s);
  if(realConfig){
   const purposeStart=ttsCalls.findIndex(call=>/doing well/i.test(call.text));
   const purposeSource=ttsCalls.slice(purposeStart);
   assert(purposeStart>=0&&purposeSource.length>=3&&purposeSource.every(call=>call.bytes>0));
   assert(purposeSource.some(call=>/doing well/i.test(call.text)&&call.bytes>=24000),'courtesy must contain more than a clipped PCM packet');
   console.log('REC-000414 real provider PCM',purposeSource.map(call=>call.bytes),'AudioSocket bytes',purposeFrames.length*320);
   if(process.env.SHAHVEX_REC414_CAPTURE){
    fs.writeFileSync(process.env.SHAHVEX_REC414_CAPTURE,Buffer.concat(purposeFrames),{mode:0o600});
    fs.writeFileSync(process.env.SHAHVEX_REC414_CAPTURE+'.intro',Buffer.concat(frames.slice(0,firstPurposeFrame)),{mode:0o600});
   }
   return;
  }
  assert(purposeFrames.some(frame=>frame.readInt16LE(100)===910),'purpose PCM reached AudioSocket');
  assert(!session.purposePermissionAnswered);
  await say('Okay');
  await until(()=>session.messages.some(m=>m.role==='assistant'&&m.content===q1));
  await say('No');
  await until(()=>session.messages.some(m=>m.role==='assistant'&&m.content===q2));
  await say('I have Medicaid.');
  await until(()=>session.messages.some(m=>m.role==='assistant'&&m.content===q3));
  await say('Yes');
  await until(()=>session.messages.some(m=>m.role==='assistant'&&/connect you/.test(m.content)));
  await say('Yes');
  await until(()=>transferConsent(session.messages));
  assert.deepEqual([...session.questionLedger.values()].map(entry=>entry.response),['No','I have Medicaid.','Yes']);
 }finally{
  releasePurpose?.();socket?.destroy();bridge.close();
  await wait(60);await f.close();fs.rmSync(dir,{recursive:true,force:true});
  if(originalTempo===undefined)delete process.env.SHAHVEX_SPEECH_TEMPO;
  else process.env.SHAHVEX_SPEECH_TEMPO=originalTempo;
 }
});

test('a generated question with failed or empty TTS remains interrupted and presence resumes it',async()=>{
 for(const failure of [false,true]){
  let failQuestion=true;
  const f=fixture({tts:(_url,init)=>{
   if(failQuestion&&JSON.parse(init.body).text===q1){
    failQuestion=false;
    return new Response(failure?'unavailable':Buffer.alloc(0),{status:failure?503:200,headers:pcmHeaders});
   }
   return new Response(sourcePcm(400,120),{headers:pcmHeaders});
  }});
  try{
   const session=await f.start();
   await f.turn({text:'Hello'});
   await f.turn({text:"I'm good, and you?"});
   const response=await f.dispatch('turn',{text:'Okay'});
   const events=(await response.text()).trim().split('\n').map(JSON.parse);
   assert(events.some(e=>e.type==='delta'&&e.text===q1));
   assert(events.some(e=>e.type==='error'));
   assert(!events.some(e=>e.type==='pcm'||e.type==='done'));
   await f.dispatch('playback-complete',{completedTurnId:events[0].turnId});
   assert.equal([...session.questionLedger.values()][0].status,'interrupted');
   await f.turn({silenceStep:2});
   assert.equal((await f.turn({text:'Yes, I am here.'})).text,q1);
   assert.equal(session.messages.findLast(m=>m.role==='user').conversationOnly,true);
   assert.equal((await f.turn({text:'Okay'})).text,q2);
  }finally{await f.close();}
 }
});
