const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {transferConsent}=require('../gateway/handoff-intent.cjs');
const {questionKey,scriptQuestionProgress}=require('../gateway/reply-integrity.cjs');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,limit=4000){const end=Date.now()+limit;while(!f()){if(Date.now()>end)throw Error('Timed out');await wait(10);}}
const q1='Are you getting any money back on a card each month?',q2='Do you have Medicare Part A or Part B or Medicaid?',q3='Are you between 60 and 80 years old?';
const config={name:'Lauren',voice:'v9-fixture',first:'customer',goal:'Discuss coverage review',task:'Ask the configured questions',instructions:'',script:'Hi, this is Lauren from Wellness Team. I am calling to discuss a coverage review.\n'+q1+'\n'+q2+'\n'+q3+'\nLet me connect you with a licensed specialist.',knowledge:'',style:'Natural'};
function fixture({tts, stt, confidence, model, owner='v9-owner',maxSessions=1}={}){
 const original=global.fetch,secret='v9-fixture-'.repeat(4);let models=0,recognitions=0,id;
 global.fetch=async (url,init)=>{
  if(String(url).includes('11434')){
   models++;
   const customer=JSON.parse(init.body).messages.findLast(message=>message.role==='user')?.content;
   const content=model ? model(customer) : /You know\?/i.test(customer||'')?'':'A licensed specialist reviews the details. '+q2;
   return new Response(JSON.stringify({message:{content},done:true})+'\n');
  }
  if(String(url).includes('8766')){recognitions++;return Response.json({text:stt?.() ?? 'Hello',confidence});}
  if (tts) return tts(url,init);
  return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 };
 const service=createTesterService({secret,testHooks:true,maxSessions});
 const request=(action,body,headers={})=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':owner,'x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json',...headers},body:body instanceof Buffer?body:JSON.stringify(body)});
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
 t=await f.turn({text:'Okay'});assert.match(t.text,/calling to discuss a coverage review/);assert.doesNotMatch(t.text,/money back|Medicare Part/i);
 t=await f.turn({text:'Yep'});assert.equal(t.text,q1);
 assert.equal((await f.turn({silenceStep:1})).text,'','silence cannot automatically repeat the question');
 assert.equal((await f.turn({text:'Okay'})).text,'');
 t=await f.turn({text:'Yes'});assert.equal(t.text,q2);
 assert.equal((await f.turn({text:'Hmm'})).text,'');
 t=await f.turn({text:'I have Medicaid.'});assert.equal(t.text,q3);
 t=await f.turn({text:'Yes, I am.'});assert.equal(t.text,'Let me connect you with a licensed specialist.');assert.doesNotMatch(t.text,/would you like|shall I|may I/i);
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
 await f.turn({silenceStep:2});t=await f.turn({text:'Yes, I am.'});assert.equal(session.messages.findLast(m=>m.role==='user').conversationOnly,true);assert.equal(session.questionLedger.get(questionKey(q2)).status,'delivered');assert.equal(session.hearingConfirmed,true);assert.match(t.text,/Medicare Part A/);assert.doesNotMatch(t.text,/can you hear|still there|last point|listening/i);
 }finally{await f.close();}
});
test('final listen does one recognition and no semantic LLM classification',async()=>{
 const f=fixture({confidence:0.72});try{await f.start();const audio=Buffer.alloc(16044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);for(let i=44;i<audio.length;i+=2)audio.writeInt16LE(2200,i);
 const r=await f.dispatch('listen',audio,{'content-type':'audio/wav','x-shahvex-turn-final':'1'});assert.equal(r.status,200);const heard=await r.json();assert.equal(heard.completion,'complete');assert.equal(heard.confidence,0.72);assert.equal(f.recognitions,1);assert.equal(f.models,0);
 }finally{await f.close();}
});
test('native customer-first waits; 350ms boundary uses one STT pass and plays first PCM before synthesis completes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v9-stream-'));let socket,release,streamOpen=false,bytes=0,probes=0,opening=0,turns=0,interrupts=0,lastVoice=0,probeAt=0;
 const latencies=[];
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'v9-stream-fixture-'.repeat(4),spoolDir:dir,endOfSpeechMs:1000,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_u,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer',mediaReady:true});
 if(e.action==='interrupt'){interrupts++;return Response.json({interrupted:true});}
 if(e.action==='listen'){probes++;probeAt=Date.now();return Response.json({text:probes===1?'Hello':'Wait.',completion:'incomplete'});}
 if(e.action==='turn'){
  if(e.opening)opening++;else turns++;
  return new Response(new ReadableStream({start(controller){
   streamOpen=true;
   const emit=value=>controller.enqueue(new TextEncoder().encode(JSON.stringify({...value,turnId:e.eventId})+'\n'));
   emit({type:'introduction'});
   emit({type:'pcm',sampleRate:24000,data:Buffer.alloc(48000,turns===1?4:8).toString('base64')});
   release=()=>{if(!streamOpen)return;streamOpen=false;try{emit({type:'done'});controller.close();}catch{}};
   init.signal.addEventListener('abort',release,{once:true});
  }}));
 }
 return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',v=>{bytes+=v.length;if(latencies.length<turns)latencies.push(Date.now()-lastVoice);});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(650);assert.equal(opening,0);assert.equal(bytes,0);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);
 const phrase=Buffer.concat(Array.from({length:10},()=>packet(0x10,voice)));socket.write(phrase);await wait(220);socket.write(phrase);lastVoice=Date.now();await until(()=>bytes>0,2200);
 assert.equal(probes,1);assert.equal(turns,1);assert.equal(streamOpen,true,'first audio must not wait for the SSE/TTS stream to close');assert(probeAt-lastVoice<650,'legacy 1-second pause must not delay the boundary');assert(Date.now()-lastVoice<1400,'fixture transport must respond without an artificial multi-second hold');
 lastVoice=Date.now();socket.write(phrase);await until(()=>latencies.length===2,1600);assert.equal(probes,2);assert.equal(interrupts,1,'a priority phrase must interrupt while the previous synthesis stream is still open');console.log('Hello-to-first-PCM loopback ms',latencies);
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
 for(const [social,rebate] of [["Uh, I'm good.",'Yes'],['Um, I am good.','No'],["Umm, I'm good, and you?",'Yes']]){
  const f=fixture();try{
   const session=await f.start('customer',{script});const intro=await f.turn({text:'Hello'});assert.match(intro.text,/How are you doing today\?$/);await f.dispatch('playback-complete',{completedTurnId:intro.id});
   const goal=await f.turn({text:social});assert.match(goal.text,/I am calling because/);assert.doesNotMatch(goal.text,/money back|Medicare Part|between 60/);
   if(!/and you/.test(social))assert.match(goal.text,/^Great,/);
   assert.equal((await f.turn({text:'Yes'})).text,q1);
   assert.equal((await f.turn({text:rebate})).text,q2,'coverage must follow every applicable rebate answer');
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
test('shared handler and bridge drain each sentence before delivering purpose or advancing screening', {timeout:process.env.SHAHVEX_REC418_REAL_REPLAY?125000:65000}, async()=>{
 const realConfig=process.env.SHAHVEX_REC414_TEST_CONFIG;
 const realFetch=global.fetch;
 const originalTempo=process.env.SHAHVEX_SPEECH_TEMPO;
 if(!realConfig)process.env.SHAHVEX_SPEECH_TEMPO='1';
 const ttsCalls=[], events=[], frames=[];
 let stallProbe=false, stalledProbe=false, spoken='Hello', releaseOpening, releasePurpose, openingSecond=false, wellbeingRequests=0, holdOpening=!realConfig, holdPurpose=!realConfig, socket, received=Buffer.alloc(0);
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
    releaseOpening=()=>controller.close();
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
   if(e.action==='listen'&&stallProbe){
    stallProbe=false;
    return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{stalledProbe=true;reject(init.signal.reason);},{once:true}));
   }
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
   ...Array.from({length:10},()=>packet(0x10,sourcePcm(3000,20).subarray(0,320))),
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
   await wait(60);
   assert.equal(events.filter(e=>e.action==='interrupt').length,0);
   releaseOpening();
   await until(()=>session.introPlaybackComplete);
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
   const beforeOverlap=events.length;
   await say('');
   await wait(3200);
   assert(!events.slice(beforeOverlap).some(e=>e.silenceStep));
   assert.equal(events.filter(e=>e.action==='interrupt').length,0);
   await say('Hello');
   await wait(60);
   assert.equal(events.filter(e=>e.action==='interrupt').length,0);
   releasePurpose();
   assert.notEqual(session.purposeDelivered,true);
  }
  await until(()=>session.purposeDelivered,32000);
  const purposeFrames=frames.slice(firstPurposeFrame);
  assert(purposeFrames.some(frame=>frame.some(Boolean)));
  assert.match(session.messages.findLast(m=>m.role==='assistant').content,/doing well.*calling/s);
  assert(ttsCalls.every(call=>!/(?:may|can) I ask|is it okay if I ask/i.test(call.text)));
  if(realConfig){
   const purposeStart=ttsCalls.findIndex(call=>/doing well/i.test(call.text));
   const purposeSource=ttsCalls.slice(purposeStart);
   assert(purposeStart>=0&&purposeSource.length>=2&&purposeSource.every(call=>call.bytes>0));
   assert(purposeSource.some(call=>/doing well/i.test(call.text)&&call.bytes>=24000),'courtesy must contain more than a clipped PCM packet');
   console.log('REC-000414 real provider PCM',purposeSource.map(call=>call.bytes),'AudioSocket bytes',purposeFrames.length*320);
   if(process.env.SHAHVEX_REC414_CAPTURE){
    fs.writeFileSync(process.env.SHAHVEX_REC414_CAPTURE,Buffer.concat(purposeFrames),{mode:0o600});
    fs.writeFileSync(process.env.SHAHVEX_REC414_CAPTURE+'.intro',Buffer.concat(frames.slice(0,firstPurposeFrame)),{mode:0o600});
   }
   if(process.env.SHAHVEX_REC418_REAL_REPLAY){
    const questions=scriptQuestionProgress(session.config.script,{completed:[]},{includeBranchQuestions:true}).map(q=>q.question);
    assert.equal(questions.length,3);
    const qState=i=>session.questionLedger?.get(questionKey(questions[i]))?.status;
    const speakAndDrain=async (utterance,pattern,complete=()=>true)=>{
     const oldFrames=frames.length,oldTts=ttsCalls.length;
     const oldAck=events.filter(e=>e.action==='playback-complete').length;
     await say(utterance);
     await until(()=>events.filter(e=>e.action==='playback-complete').length>oldAck && complete(),18000);
     const speech=session.messages.findLast(m=>m.role==='assistant').content;
     const output=frames.slice(oldFrames);
     assert.match(speech,pattern);
     assert(output.some(frame=>frame.some(Boolean)));
     assert(ttsCalls.slice(oldTts).filter(call=>call.bytes).every(call=>call.bytes>=3840));
     console.log('REC418 loopback',JSON.stringify({utterance,speech,voicePcm:ttsCalls.slice(oldTts).map(call=>call.bytes),audioSocketBytes:output.length*320}));
     return speech;
    };
    await speakAndDrain('Okay.',/rebate or money back/i,()=>qState(0)==='delivered');
    const side=await speakAndDrain('No. Where are you from?',/medicare part A or part B or medicaid\?/i,()=>qState(1)==='delivered');
    assert.doesNotMatch(side,/getting any rebate|calling because/i);
    await speakAndDrain('Mm, I have hot pee.',/medicare part A or part B or medicaid\?/i,()=>qState(1)==='delivered');
    await speakAndDrain('I have Part B.',/between 60 and 80 years old\?/i,()=>qState(2)==='delivered');
    await speakAndDrain('Please hang up the call.',/may I go ahead\?/i);
    const resumed=await speakAndDrain('Oh, yeah, sure.',/between 60 and 80 years old\?/i,()=>qState(2)==='delivered');
    assert.doesNotMatch(resumed,/calling because|doing well|how are you/i);
    await until(()=>session.messages.at(-1)?.role==='assistant'&&/Can you hear me\?$/.test(session.messages.at(-1).content),16000);
    await speakAndDrain('Yes, I am. I say I know that.',/between 60 and 80 years old\?/i,()=>qState(2)==='delivered');
    assert.equal(qState(2),'delivered');
    await say('Please hang up the call.');
    await until(()=>events.some(e=>e.action==='hangup'),4000);
   }
   return;
  }
  assert(purposeFrames.some(frame=>frame.readInt16LE(100)===910),'purpose PCM reached AudioSocket');
  assert(!session.purposeAcknowledged);
  stallProbe=true;
  await say('unresolved noise');
  await say('Okay');
  await until(()=>stalledProbe&&[...session.questionLedger.values()][0]?.status==='delivered',7000);
  assert(!session.messages.some(m=>m.role==='user'&&m.content==='unresolved noise'));
  await say('No');
  await until(()=>[...session.questionLedger.values()][1]?.status==='delivered');
  await say('Yes, I have.');
  await until(()=>[...session.questionLedger.values()][2]?.status==='delivered');
  await say('Yes, I am.');
  await until(()=>session.messages.some(m=>m.role==='assistant'&&/connect you/.test(m.content)));
  await say('Yes');
  await until(()=>transferConsent(session.messages));
  assert.deepEqual([...session.questionLedger.values()].map(entry=>entry.response),['No','Yes, I have.','Yes, I am.']);
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
   assert.equal((await f.turn({text:'Yes'})).text,q2);
  }finally{await f.close();}
 }
});

test('REC416 reciprocal variation and opening questions play the configured purpose before screening',async()=>{
 for(const [input,courtesy] of [
  ['I am good at Naba. How about you?',/doing well/],
  ['How about yourself today?',/doing well/],
  ['What company are you from?',/Lauren from Wellness Team/],
  ['Why are you calling?',/calling to discuss a coverage review/],
 ]){
  const f=fixture();
  try{
   const session=await f.start();
   await f.turn({text:'Hello'});
   const reply=await f.turn({text:input},{ack:false});
   assert.match(reply.text,courtesy);
   assert.equal((reply.text.match(/calling to discuss a coverage review/g)||[]).length,1);
   assert.doesNotMatch(reply.text,/may I ask|can I ask|is it okay if I ask/i);
   assert.doesNotMatch(reply.text,/money back|Medicare Part/);
   assert(reply.events.some(event=>event.type==='pcm'&&Buffer.from(event.data,'base64').some(Boolean)));
   assert.notEqual(session.purposeDelivered,true);
   await f.dispatch('playback-complete',{completedTurnId:reply.id});
   const followup=await f.turn({text:'Who are you?'});
   assert.match(followup.text,/Lauren from Wellness Team/);
   assert.doesNotMatch(followup.text,/calling to discuss|money back|may I ask/i);
   assert.equal((await f.turn({text:'Okay'})).text,q1);
   assert.equal(f.models,0);
  }finally{await f.close();}
 }
});

test('REC416 explicit No plus why advances coverage once; Okay acknowledges the explanation without answering age',async()=>{
 const f=fixture();
 try{
  const session=await f.start('customer',{goal:'Discuss a Medicare rebate review',script:config.script.replace('a coverage review','a Medicare rebate review')});
  await f.turn({text:'Hello'});
  await f.turn({text:'I am good. How about you?'});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  assert.equal((await f.turn({text:'No.'})).text,q2);
  const why=await f.turn({text:'No. Why are you asking me these questions?'});
  assert.match(why.text,/Your rebate, coverage, and age help us know what to check/);
  assert(why.text.endsWith(q3));
  assert(!why.text.includes(q2));
  assert(why.events.some(event=>event.type==='pcm'&&Buffer.from(event.data,'base64').some(Boolean)));
  assert.deepEqual([...session.questionLedger.values()].map(entry=>[entry.status,entry.response]),[
   ['answered','No.'],['answered','No'],['delivered',undefined],
  ]);
  assert.equal((await f.turn({text:'Okay'})).text,'');
  assert.equal([...session.questionLedger.values()].at(-1).status,'delivered');
  assert.equal((await f.turn({text:'Yes'})).text,'Let me connect you with a licensed specialist.');
  assert.equal((await f.turn({text:'Yes'})).text,'');
  assert(transferConsent(session.messages));
  assert.equal(f.models,0);
 }finally{await f.close();}
});

test('why alone leaves coverage unanswered and Okay resumes a question interrupted during its explanation',async()=>{
 const f=fixture();
 try{
  const session=await f.start('customer',{goal:'Discuss a Medicare rebate review',script:config.script.replace('a coverage review','a Medicare rebate review')});
  await f.turn({text:'Hello'});
  await f.turn({text:"I'm good"});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  assert.equal((await f.turn({text:'No'},{ack:false})).text,q2);
  await f.dispatch('interrupt',{});
  const why=await f.turn({text:'Why do you ask me these questions?'},{ack:false});
  assert(why.text.endsWith(q2));
  await f.dispatch('interrupt',{});
  assert.equal((await f.turn({text:'Okay'})).text,q2);
  assert.deepEqual([...session.questionLedger.values()].map(entry=>entry.status),['answered','delivered','pending']);
  assert.equal((await f.turn({text:'I have Medicaid.'})).text,q3);
  assert.equal(f.models,0);
 }finally{await f.close();}
});

test('contextual affirmations require a delivered compatible question and preserve the reply',async()=>{
 for(const [question,reply] of [[q3,'Yeah, I am.'],[q2,'Yes, I do.'],[q2,'Yes, I have.'],[q2,'Yep.'],[q2,'That’s right.']]){
  const f=fixture();
  try{
   const session=await f.start('customer',{script:config.script.replace(q1+'\n'+q2+'\n'+q3,question+'\n'+q1)});
   await f.turn({text:'Hello'});
   await f.turn({text:"I'm good."});
   assert.equal((await f.turn({text:'Okay'},{ack:false})).text,question);
   await f.dispatch('interrupt',{});
   assert.equal((await f.turn({text:reply})).text,question);
   assert.equal(session.questionLedger.get(questionKey(question)).status,'delivered');
   assert.equal((await f.turn({text:reply})).text,q1);
   assert.deepEqual(session.questionLedger.get(questionKey(question)),{status:'answered',response:reply});
   assert.equal(session.messages.filter(m=>m.role==='assistant'&&m.content===q1).length,1);
  }finally{await f.close();}
 }
 const {rememberQuestions}=require('../gateway/question-memory.cjs');
 for(const question of ['How old are you?','What is your name?','Where do you live?']){
  assert.deepEqual(rememberQuestions([{role:'assistant',content:question},{role:'user',content:'Yes, I am.'}]).completed,[]);
 }
});

test('REC418 resumes an interrupted age question after greetings, hangup consent and presence',async()=>{
 const f=fixture();
 try{
  const s=await f.start();
  await f.turn({text:'Hello'});
  await f.turn({text:"I'm good. And you?"});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  assert.equal((await f.turn({text:'No.'})).text,q2);
  assert.equal((await f.turn({text:'Mm, I have hot pee.'})).text,q2);
  assert.equal(s.questionLedger.get(questionKey(q2)).status,'delivered');
  const interrupted=await f.turn({text:'Yes, I do.'},{ack:false});
  assert.equal(interrupted.text,q3);
  await f.dispatch('interrupt',{});
  await f.dispatch('playback-complete',{completedTurnId:interrupted.id});
  const retry=await f.turn({text:'Hello'},{ack:false});
  assert.equal(retry.text,q3);
  await f.dispatch('interrupt',{});
  await f.turn({text:'Please hang up the call.'});
  assert.equal((await f.turn({text:'Oh, yeah, sure.'})).text,q3);
  await f.turn({silenceStep:2});
  assert.equal((await f.turn({text:'Yes, I am. I say I know that.'})).text,q3);
  assert.equal(s.awaitingHearingConfirmation,false);
  assert.equal(s.questionLedger.get(questionKey(q3)).status,'delivered');
  assert((await f.turn({text:'Please hang up the call.'})).events.some(e=>e.type==='end_call'&&e.immediate));
 }finally{await f.close();}
});

test('REC418 keeps the answer before a configured location question and rejects a false clarification',async()=>{
 const f=fixture();
 try{
  const s=await f.start('customer',{instructions:'Role: benefits coordinator'});
  await f.turn({text:'Hello'});
  await f.turn({text:"I'm good. And you?"});
  await f.turn({text:'Okay'});
  assert.doesNotMatch((await f.turn({text:'You know?'})).text,/repeat your last question/i);
  const result=await f.turn({text:'No. Where are you calling from?'});
  assert.match(result.text,/Phoenix, Arizona, United States/);
  assert(result.text.endsWith(q2));
  assert(!result.text.includes(q1));
  assert.equal(s.questionLedger.get(questionKey(q1)).response,'No.');
  for (const text of ['Where are you form?', 'Where is your company based?', 'Where are you located?']) {
   assert.match((await f.turn({text})).text,/Phoenix, Arizona, United States/);
  }
  for (const text of ['Are you a representative of Wellness Team?', 'Do you represent Welness Team?', 'Are you from Wellness-Team?']) {
   assert.equal((await f.turn({text})).text,`Yes, I'm a representative of Wellness Team. ${q2}`);
  }
  for (const text of ['Do you represent Wellness Team USA?', 'Are you a Medicare representative?', 'Are you an official government representative?', 'Are you a licensed specialist?']) {
   assert.match((await f.turn({text})).text,/^I can't confirm/);
  }
  assert.match((await f.turn({text:'What is your street address?'})).text,/^I don't have a street or postal address to share\./);
  assert.equal(s.questionLedger.get(questionKey(q1)).response,'No.');
  assert.equal((await f.turn({text:'I have Part B.'})).text,q3);
 }finally{await f.close();}
});

test('configured-company identity confirmations preserve the pending screening question and compound answers', async () => {
 const f=fixture();
 try {
  const company='Medicare Wellness Support Team';
  const session=await f.start('ai',{script:config.script.replace('Wellness Team',company)});
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  assert.equal((await f.turn({text:'Yes'})).text,q1);
  const confirmation="Yes, I'm a representative of "+company+". ";
  for (const text of [
   'Are you an uh wellness sport team as representative?',
   'Uh, I say you are a wellness sport representative.',
   'Are you a representative of Medicare Wellness Support Team?',
   'Are you a wellness support representative?',
  ]) {
   assert.equal((await f.turn({text})).text,confirmation+q1,text);
   assert.equal(session.questionLedger.get(questionKey(q1)).status,'delivered',text);
  }
  for (const text of [
   'Do you represent Wellness Support Team USA?',
   'Are you a government representative of Medicare Wellness Support Team?',
   'Are you a licensed specialist?',
  ]) {
   assert.equal((await f.turn({text})).text,
    (text.startsWith('Do you')?"I can't confirm that affiliation.":"I can't confirm that affiliation or qualification.")+' '+q1,text);
  }
  assert.equal((await f.turn({text:'Are you a representative?'})).text,'Which company do you mean? '+q1);
  assert.equal((await f.turn({text:'No. Are you a wellness support representative?'})).text,confirmation+q2);
  assert.equal(session.questionLedger.get(questionKey(q1)).response,'No.');
  assert.equal((await f.turn({text:'I have Part B. Uh, I say you are a wellness sport representative.'})).text,confirmation+q3);
  assert.equal(session.questionLedger.get(questionKey(q2)).response,'I have Part B.');
  assert.equal(f.models,0);
 } finally {await f.close();}
});

test('hearing recovery uses the current step, consumes presence and respects exact playback IDs', async () => {
  const f = fixture();
  try {
    const session = await f.start('ai');
    const opening = await f.turn({opening:true});
    const intro = await f.turn({text:'I am not hear you.'});
    assert.equal(intro.text, 'Let me repeat that. ' + opening.text);

    const purpose = await f.turn({text:'Okay'}, {ack:false});
    await f.dispatch('playback-complete', {completedTurnId:opening.id});
    assert.notEqual(session.purposeDelivered, true);
    const purposeReplay = await f.turn({text:"I can't hear you."});
    assert.equal(purposeReplay.text, 'Let me repeat that. ' + purpose.text);
    const heardCheck = await f.turn({text:'Can you hear me?'});
    assert.equal(heardCheck.text, 'Yes, I can hear you. ' + purpose.text);
    await f.turn({text:'Go ahead'});

    for (const [question, answer, next] of [
      [q1, 'No', q2], [q2, 'I have Medicaid.', q3],
      [q3, 'Yes', 'Let me connect you with a licensed specialist.'],
    ]) {
      assert.equal((await f.turn({text:"Sorry, I didn't hear you. What did you say?"})).text, 'Let me repeat that. ' + question);
      await f.turn({silenceStep:2});
      assert.equal((await f.turn({text:"Yes, I'm here."})).text, question);
      assert.equal(session.messages.findLast(m => m.role === 'user').conversationOnly, true);
      assert.notEqual(session.questionLedger.get(questionKey(question)).status, 'answered');
      assert.equal((await f.turn({text:answer})).text, next);
      assert.equal(session.questionLedger.get(questionKey(question)).response, answer);
    }
    assert.equal(f.models, 0);
  } finally {
    await f.close();
  }
});

test('a failed hearing replay retries once without committing its playback or caller speech again', async () => {
  let fail = false;
  const f = fixture({tts: () => fail
    ? new Response('unavailable', {status:503})
    : new Response(new Uint8Array(4800).fill(12), {headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})});
  try {
    const session = await f.start('ai', {voice:'hearing-failure-fixture'});
    const opening = await f.turn({opening:true}, {ack:false});
    const complaint = "I can't hear you.";
    fail = true;
    const failure = await f.dispatch('turn', {text:complaint});
    const events = (await failure.text()).trim().split('\n').map(JSON.parse);
    assert(events.some(e => e.type === 'error'));
    assert(!events.some(e => e.type === 'pcm'));
    assert.notEqual(session.introPlaybackComplete, true);
    fail = false;
    const retry = await f.turn({silenceStep:1}, {ack:false});
    assert.equal(retry.text, 'Let me repeat that. ' + opening.text);
    assert.notEqual(session.introPlaybackComplete, true);
    await f.dispatch('playback-complete', {completedTurnId:retry.id});
    assert.equal(session.introPlaybackComplete, true);
    assert.equal((await f.turn({silenceStep:1})).text, '');
    assert.equal(session.messages.filter(m => m.role === 'user' && m.content === complaint).length, 1);
  } finally {
    await f.close();
  }
});

test('empty recognition preserves a pending hearing replay for one delivery retry', async () => {
  const f = fixture({stt: () => ''});
  try {
    const session = await f.start('ai');
    const opening = await f.turn({opening:true});
    const replay = await f.turn({text:"Sorry. I didn't hear you."}, {ack:false});
    const audio = Buffer.alloc(16044);
    audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4);
    audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
    audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
    for (let index = 44; index < audio.length; index += 2) audio.writeInt16LE(2200, index);
    const empty = await f.dispatch('turn', audio, {'content-type':'audio/wav'});
    assert(!(await empty.text()).includes('"type":"pcm"'));
    assert.equal(session.pendingPlayback.turnId, replay.id);
    const retry = await f.turn({silenceStep:1}, {ack:false});
    assert.equal(retry.text, 'Let me repeat that. ' + opening.text);
    await f.dispatch('playback-complete', {completedTurnId:replay.id});
    assert.equal(session.pendingPlayback.turnId, retry.id);
    await f.dispatch('playback-complete', {completedTurnId:retry.id});
    assert.equal((await f.turn({silenceStep:1})).text, '');
  } finally {
    await f.close();
  }
});

test('a cancelled hearing replay releases the worker and retries once', async () => {
  let onSynthesisStarted;
  const f = fixture({tts: (_url, init) => {
    if (!onSynthesisStarted) {
      return new Response(new Uint8Array(4800).fill(12), {
        headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'},
      });
    }
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true});
      onSynthesisStarted();
    });
  }});
  try {
    const session = await f.start('ai', {voice:'hearing-cancellation-fixture'});
    const opening = await f.turn({opening:true});
    const started = new Promise(resolve => { onSynthesisStarted = resolve; });
    const response = await f.dispatch('turn', {text:"I can't hear you."});
    const output = response.text();
    await started;
    const interrupted = await f.dispatch('interrupt', {});
    assert.equal(interrupted.status, 200);
    assert(!(await output).includes('"type":"pcm"'));
    assert.equal(session.busy, false);
    onSynthesisStarted = undefined;
    assert.equal((await f.turn({silenceStep:1})).text, 'Let me repeat that. ' + opening.text);
    assert.equal((await f.turn({silenceStep:1})).text, '');
  } finally {
    await f.close();
  }
});

test('native scripted turns accept short answers and resume the pending question after an identity question', async()=>{
 const spoken=[];
 const f=fixture({owner:'vici-repair-fixture',tts:(_url,init)=>{
  spoken.push(JSON.parse(init.body).text);
  return new Response(sourcePcm(400,120),{headers:pcmHeaders});
 }});
 try{
  const session=await f.start('ai');
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  const first=await f.turn({text:'Okay'},{ack:false});
  assert(first.events.some(e=>e.type==='pcm'));
  await f.dispatch('interrupt',{});
  const next=await f.turn({text:'No'});
  assert(next.events.some(e=>e.type==='business-outcome'));
  assert.equal(session.questionLedger.get(questionKey(q1)).response,'No');
  assert.match(next.text,/Medicare Part A/);
  const third=await f.turn({text:'Yes'});
  assert(third.events.some(e=>e.type==='business-outcome'));
  assert.match(third.text,/between 60/);
  const side=await f.turn({text:'Who are you?'});
  assert.match(side.text,/Lauren.*Wellness Team/i);
  assert(!side.events.some(e=>e.type==='question-disposition'&&e.outcome==='unclear'));
  assert.match(side.text,/between 60/);
  for(const q of [q1,q2])assert.equal(spoken.filter(text=>text.includes(q)).length,1,q);
  assert.equal(spoken.filter(text=>text.includes(q3)).length,1);
  assert.match(side.text,/could you tell me whether you are between 60/i);
 }finally{await f.close();}
});

test('native silence advances the script and records the unanswered question', async()=>{
 const f=fixture({owner:'vici-silent-continuation'});
 try{
  const session=await f.start('ai');
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  const continuation=await f.turn({silenceStep:1});
  assert.equal(continuation.text,q2);
  assert(continuation.events.some(e=>e.type==='question-disposition'&&e.questionId===questionKey(q1)&&e.outcome==='unanswered'));
  assert.equal(session.questionLedger.get(questionKey(q2)).status,'delivered');
  assert.equal((await f.turn({text:'Yes'})).text,q3);
 }finally{await f.close();}
});

test('native transfer discussion resumes the same announcement without asking permission again', async()=>{
 const f=fixture({owner:'vici-transfer-followup'});
 try{
  await f.start('ai');
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  await f.turn({text:'Okay'});
  await f.turn({text:'No'});
  await f.turn({text:'Yes'});
  const handoff=await f.turn({text:'Yes'});
  assert(handoff.events.some(e=>e.type==='handoff-announcement'));
  const stale=await f.dispatch('turn',{text:'Who is the specialist?',interruptedHandoff:crypto.randomUUID()});
  assert.equal(stale.status,409);
  const followup=await f.turn({text:'Who is the specialist?',interruptedHandoff:handoff.id});
  assert(followup.text.endsWith('Let me connect you with a licensed specialist.'),followup.text);
  assert(!followup.text.includes('?'));
  assert(followup.events.some(e=>e.type==='handoff-announcement'&&e.turnId===followup.id));
 }finally{await f.close();}
});

test('a directed insult ends the native voice turn immediately without TTS', async()=>{
 const f=fixture({owner:'vici-abuse-fixture'});
 try{
  await f.start('ai');
  await f.turn({opening:true});
  const reply=await f.turn({text:'You are an asshole.'});
  assert(!reply.events.some(e=>e.type==='pcm'||e.type==='delta'));
  assert(reply.events.some(e=>e.type==='end_call'&&e.reason==='abusive_language'&&e.immediate));
 }finally{await f.close();}
});

test('native progression writes each scripted question once to an AudioSocket peer', async()=>{
 const originalTempo=process.env.SHAHVEX_SPEECH_TEMPO;
 process.env.SHAHVEX_SPEECH_TEMPO='1';
 let socket, received=Buffer.alloc(0), heard='', opening=0;
 const frames=[], requests=[], playback=new Set();
 const waveCodes=new Map([[q1,1010],[q2,1420],[q3,1830]]);
 const f=fixture({owner:'vici-socket-repair-fixture',stt:()=>heard,confidence:0.99,
  tts:(_url,init)=>{
   const text=JSON.parse(init.body).text;
   requests.push(text);
   return new Response(sourcePcm(waveCodes.get(text)||530,120),{headers:pcmHeaders});
  },
 });
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repair-native-audiosocket-'));
 const bridge=createBridge({siteUrl:'https://fixture.invalid',connectionId:crypto.randomUUID(),
  secret:'repair-socket-fixture-'.repeat(4),spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},
  fetchImpl:async(_url,init)=>{
   const e=JSON.parse(init.body);
   if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'ai',mediaReady:true});
   if(e.opening)opening++;
   if(e.action==='playback-complete')playback.add(e.completedTurnId);
   return ['turn','listen','interrupt','playback-complete'].includes(e.action)
    ? f.dispatch(e.action,e.audio?Buffer.from(e.audio,'base64'):e,{
      'content-type':e.audio?'audio/wav':'application/json','x-shahvex-turn':e.eventId,
      'x-shahvex-completed-turn':e.completedTurnId||'',
    })
    : Response.json({saved:true});
  },
 });
 async function say(text, expectedCode){
  const previous=frames.length, previousPlayback=playback.size;
  heard=text;
  socket.write(Buffer.concat([
   ...Array.from({length:10},()=>packet(0x10,sourcePcm(3000,20).subarray(0,320))),
   ...Array.from({length:35},()=>packet(0x10,Buffer.alloc(320))),
  ]));
  await until(()=>playback.size>previousPlayback && frames.slice(previous).some(frame=>frame.readInt16LE(100)===expectedCode));
 }
 try{
  const session=await f.start('ai');
  await new Promise((resolve,reject)=>{bridge.audio.once('error',reject);bridge.audio.listen(0,'127.0.0.1',resolve);});
  socket=net.connect(bridge.audio.address().port,'127.0.0.1');
  socket.on('data',data=>{
   received=Buffer.concat([received,data]);
   while(received.length>=3&&received.length>=3+received.readUInt16BE(1)){
    const end=3+received.readUInt16BE(1);
    if(received[0]===0x10)frames.push(received.subarray(3,end));
    received=received.subarray(end);
   }
  });
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.once('connect',resolve);});
  socket.write(packet(1,crypto.randomBytes(16)));
  await until(()=>session.introPlaybackComplete);
  await say('Okay',530);
  await say('Okay',1010);
  await say('No',1420);
  await say('Yes',1830);
  assert.equal(opening,1);
  for(const question of waveCodes.keys())assert.equal(requests.filter(text=>text===question).length,1);
 }finally{
  socket?.destroy();bridge.close();await wait(50);await f.close();fs.rmSync(dir,{recursive:true,force:true});
  if(originalTempo===undefined)delete process.env.SHAHVEX_SPEECH_TEMPO;
  else process.env.SHAHVEX_SPEECH_TEMPO=originalTempo;
 }
});

test('scenario actions use the native worker event path', async () => {
 const cases = [
  {text:'I think so, can you check?', event:'handoff-announcement', reason:'assistance', retained:'I think so'},
  {text:'Maybe, would you verify it for me?', event:'handoff-announcement', reason:'assistance', retained:'Maybe'},
  {text:'Let me check', spoken:/take your time/, pending:true},
  {text:'No', event:'business-answer', spoken:/Medicare Part A/},
  {text:'Yes', event:'business-answer', spoken:/Medicare Part A/},
  {text:"I can't tell", event:'question-disposition', spoken:/Medicare Part A/},
  {text:'Hello?', pending:true},
  {text:'Just put me through to someone', event:'handoff-announcement', reason:'requested'},
  {text:'Not interested, please transfer me', event:'end_call', reason:'customer_request'},
  {text:"Don't call me again, can you transfer me?", event:'dnc-request', also:'end_call'},
  {text:'Call me later', event:'end_call', spoken:/can't schedule a callback/},
  {text:'[TRANSFER]', event:'question-disposition', spoken:/Medicare Part A/},
 ];
 for (const item of cases) {
  const f=fixture({owner:'vici-scenario-action'});
  try {
   const session=await f.start('ai');
   await f.turn({opening:true});
   await f.turn({text:'Okay'});
   assert.equal((await f.turn({text:'Okay'})).text,q1);
   const {events,text}=await f.turn({text:item.text});
   const event=events.find(e=>e.type===item.event);
   if(item.event) assert.ok(event,item.text);
   if(item.also) assert.ok(events.some(e=>e.type===item.also),item.text);
   if(item.reason) assert.equal(event.scenarioHandoff || event.reason,item.reason,item.text);
   if(item.retained) assert.ok(events.some(e=>e.type==='business-answer'&&e.response===item.retained),item.text);
   if(item.spoken) assert.match(text,item.spoken,item.text);
   if(item.pending) assert.equal(session.questionOutcomes.has(questionKey(q1)),false,item.text);
   assert(!text.includes(q1),item.text);
   assert(!text.includes('[TRANSFER]'),item.text);
   assert.equal(events.filter(e=>e.type==='handoff-announcement').length,item.event==='handoff-announcement'?1:0,item.text);
   assert.equal(f.models,0,item.text);
  } finally { await f.close(); }
 }
});

test('Lauren rephrases a question once and advances on a second clarification request', async () => {
 const f=fixture({owner:'vici-scenario-repeat'});
 try {
  const session=await f.start('ai');
  await f.turn({opening:true});
  const replay=await f.turn({text:'Hello?'});
  assert.match(replay.text,/^Hi, this is Lauren/);
  await f.turn({text:'Okay'});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  const first=await f.turn({text:'What then?'});
  assert.equal(first.text,'Of course, could you tell me whether you are getting any money back on a card each month?');
  assert.equal(session.rephrasedQuestions.size,1);
  const second=await f.turn({text:'I say what?'});
  assert.equal(second.text,q2);
  assert(second.events.some(e=>e.type==='question-disposition'&&e.questionId===questionKey(q1)&&e.outcome==='unclear'));
  assert.equal(f.models,0);
 } finally { await f.close(); }
});

test('REC-001170 mmm-hmm counts as yes on a pending yes/no question and advances',async()=>{
 const f=fixture({owner:'vici-lauren-mmm-hmm'});
 try{
  const second='Do you live in Texas?';
  await f.start('ai',{script:config.script.replace(q2,second)});
  await f.turn({opening:true});
  await f.turn({text:'Okay.'});
  assert.equal((await f.turn({text:'Okay.'})).text,q1);
  const why=await f.turn({text:'Why I tell you'});
  assert.match(why.text,/helps me understand.*could you tell me whether/i);
  assert(!why.events.some(event=>event.type==='business-answer'));
  const acknowledgment=await f.turn({text:'Mmm-hmm.'});
  assert.equal(acknowledgment.text,second);
  assert(acknowledgment.events.some(event=>event.type==='pcm'));
  assert(acknowledgment.events.some(event=>event.type==='business-answer'&&event.response==='Mmm-hmm.'&&event.interpretedAs==='yes'));
  assert(!acknowledgment.events.some(event=>event.type==='question-disposition'));
  const negative=await f.turn({text:'Uh, no.'});
  assert.equal(negative.text,q3);
  assert(negative.events.some(event=>event.type==='business-answer'&&event.interpretedAs==='no'));
  assert.equal(f.models,0);
 }finally{await f.close();}
});

test('REC-001170 clipped wellbeing delivers purpose and waits before screening',async()=>{
 const f=fixture({owner:'vici-lauren-clipped-intro'});
 try{
  await f.start('ai');
  await f.turn({opening:true});
  await f.turn({text:'Hello.'});
  const purpose=await f.turn({text:"I'm good at"});
  assert.match(purpose.text,/calling to discuss a coverage review/i);
  assert(!purpose.text.includes(q1));
  assert.equal((await f.turn({text:'Okay.'})).text,q1);
  assert.equal(f.models,0);
 }finally{await f.close();}
});

test('Lauren answers a side question and stays on the rebate step through an unrelated reply',async()=>{
 const f=fixture({owner:'vici-lauren-detour',model:input=>input.includes('at work')
  ? 'I understand you are at work.' : 'I can only explain the review process.'});
 try{
  await f.start('ai');
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  assert.equal((await f.turn({text:'Okay'})).text,q1);
  for (const [text,reply] of [["I'm at work right now.",'I understand you are at work.'],
                           ['Can you explain what this means?','I can only explain the review process.']]) {
   const turn=await f.turn({text});
   assert.ok(turn.text.startsWith(reply),turn.text);
   assert.match(turn.text,/could you tell me whether you are getting any money back/i);
   assert(!turn.events.some(event=>['business-answer','question-disposition','handoff-announcement'].includes(event.type)));
  }
  assert.equal((await f.turn({text:'No.'})).text,q2);
 }finally{await f.close();}
});

test('Lauren gives fast health and personal replies and resumes the correct script step',async()=>{
 const f=fixture({owner:'vici-lauren-health-personal'});
 const age='Are you in the age of 50 to 80?';
 try{
  await f.start('ai',{script:config.script.replace(q2+'\n'+q3,age)});
  await f.turn({opening:true});
  await f.turn({text:'Okay.'});
  assert.equal((await f.turn({text:'Okay.'})).text,q1);
  for(const [text,answer] of [['Are you a smoker?',/don't smoke.*lung cancer/i],
                               ['Are you drinking?',/don't drink alcohol.*liver/i],
                               ['Are you getting nicotine?',/don't use nicotine.*addictive/i]]){
   const reply=await f.turn({text});
   assert.match(reply.text,answer);
   assert.match(reply.text,/could you tell me whether you are getting any money back/i);
   assert(!reply.events.some(e=>e.type==='business-answer'||e.type==='handoff-announcement'));
  }
  const compound=await f.turn({text:'No are you married?'});
  assert.match(compound.text,/don't have a spouse.*are you in the age of 50 to 80/i);
  assert(compound.events.some(e=>e.type==='business-answer'&&/^no/i.test(e.response)));
  const final=await f.turn({text:'Yes do you have any kids?'});
  assert.match(final.text,/don't have a family.*let me connect/i);
  assert(final.events.some(e=>e.type==='handoff-announcement'&&e.turnId===final.id));
  assert.equal(f.models,0);
 }finally{await f.close();}
});

test('Lauren asks the age question after the rephrased rebate question before transfer', async () => {
 const f=fixture({owner:'vici-lauren-checklist'});
 const rebate='Are you currently getting any rebate or money back on a card each month?';
 const age='are you in the age of 50 to 80?';
 const script=`Hi there, this is Lauren with Wellness Team. I am calling about a coverage review. ${rebate}
 Perfect, it looks like you may have a refund owed.
 so just let me know ${age}
 VOICEMAIL RESTRICTION:
 End the call silently if it is confirmed as voicemail.
 Let me connect you with a licensed specialist.`;
 try {
  assert.deepEqual(scriptQuestionProgress(script,{completed:[]}).map(step=>step.question),[rebate,age]);
  await f.start('ai',{script});
  await f.turn({opening:true});
  await f.turn({text:'Okay'});
  assert.equal((await f.turn({text:'Okay'})).text,rebate);
  assert.match((await f.turn({text:'What?'})).text,/could you tell me whether/);
  const ageTurn=await f.turn({text:'No.'});
  assert.equal(ageTurn.text.toLowerCase(),age);
  assert(!ageTurn.events.some(event=>event.type==='handoff-announcement'));
  assert((await f.turn({text:'Yes.'})).events.some(event=>event.type==='handoff-announcement'));
  assert.equal(f.models,0);
 } finally { await f.close(); }
});

test('scenario no branches are scoped and a coverage explanation never replays the question', async () => {
 for (const [question, input, event, speech] of [
  [q3, 'No.', 'end_call', /Goodbye/],
  [q2, 'No.', 'end_call', /Goodbye/],
  [q2, "What's Part B?", 'question-disposition', /Part B is Medicare medical coverage/],
 ]) {
  const f=fixture({owner:'vici-scenario-scope'});
  try {
   await f.start('ai',{script:config.script.replace([q1,q2,q3].join('\n'),question+'\n'+q1)});
   await f.turn({opening:true});
   await f.turn({text:'Okay'});
   assert.equal((await f.turn({text:'Okay'})).text,question);
   const turn=await f.turn({text:input});
   assert.ok(turn.events.some(e=>e.type===event));
   assert.match(turn.text,speech);
   assert(!turn.text.includes(question));
  } finally { await f.close(); }
 }
});

test('concurrent native calls do not share question rephrase budgets', async () => {
 const f1=fixture({owner:'vici-scenario-first',maxSessions:2}),f2=fixture({owner:'vici-scenario-second',maxSessions:2});
 try {
  const ready=async f=>{
   const session=await f.start('ai');
   await f.turn({opening:true});
   await f.turn({text:'Okay'});
   await f.turn({text:'Okay'});
   return session;
  };
  const [first,second]=await Promise.all([ready(f1),ready(f2)]);
  await f1.turn({text:'Repeat please.'});
  await f1.turn({text:'What did you ask?'});
  assert.equal(first.rephrasedQuestions.size,1);
  assert.equal(second.rephrasedQuestions,undefined);
  const replay=await f2.turn({text:'Repeat please.'});
  assert.match(replay.text,/^Of course, could you tell me whether/);
  assert.equal(second.rephrasedQuestions.size,1);
  assert.equal((await f2.turn({text:"Yes."})).text,q2);
  assert.equal(first.rephrasedQuestions.size,1);
 } finally {
  await f2.close();
  await f1.close();
 }
});

test('native customer-first opens only when the bridge requests a silence introduction', async () => {
 const f = fixture({owner:'vici-customer-first'});
 try {
  await f.start();
  assert.equal((await f.turn({opening:true})).text, '');
  const intro = await f.turn({opening:true,silenceOpening:true});
  assert.match(intro.text,/Lauren.*Wellness Team/);
  assert.ok(intro.events.some(event => event.type === 'pcm'));
  assert.ok((await f.turn({text:'Doing well, thanks.'})).text);
 } finally {
  await f.close();
 }
});
