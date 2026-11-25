const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { createBridge, packet, signature } = require('../deployment/vicidial-bridge/server.cjs');
const { CustomerSilence } = require('../gateway/conversation-silence.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 250; i++) {
    if (predicate()) return;
    await wait(20);
  }
  assert.fail('Expected bridge event did not arrive');
}

async function fixture(handle, {initialSilence = false, first = 'customer', score = 0, connectedAt} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-silence-'));
  const callId = crypto.randomUUID();
  const secret = 'silence-fixture-'.repeat(4);
  const requests = [];
  const bridge = createBridge({
    siteUrl: 'https://fixture.invalid', connectionId: crypto.randomUUID(), secret, spoolDir: dir,
    resolveRegistration: async uuid => ({uuid,audioUuid:uuid,externalCallId:'direct-'+uuid.replaceAll('-',''),agentUser:'fixture'}),
    logger: () => {},
    enforceInitialSilence: initialSilence, createSpeechScorer: () => async () => score,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      if (request.action === 'connected') return Response.json({callId, first, mediaReady:true, connectedAt});
      return await handle(request, init) || Response.json({saved:true});
    },
  });
  await new Promise(resolve => bridge.audio.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => bridge.control.listen(0, '127.0.0.1', resolve));
  const socket = net.connect(bridge.audio.address().port, '127.0.0.1');
  socket.resume();
  await new Promise(resolve => socket.once('connect', resolve));
  socket.write(packet(1, crypto.randomBytes(16)));
  await until(() => requests.some(request => request.action === 'connected'));
  return {
    requests, socket,
    async command(action) {
      const stamp = String(Date.now());
      const body = Buffer.from(JSON.stringify({callId,action}));
      const response = await fetch('http://127.0.0.1:'+bridge.control.address().port+'/command',{
        method:'POST',body,headers:{'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(secret,stamp,'POST','/command',body)},
      });
      assert.equal(response.status,200);
    },
    pcm(frame, count = 1) {
      socket.write(Buffer.concat(Array.from({length:count},()=>packet(0x10,frame))));
    },
    speak() {
      const voice = Buffer.alloc(320);
      for (let i=0;i<320;i+=2) voice.writeInt16LE(3800*Math.sin(i/10),i);
      socket.write(Buffer.concat([
        ...Array.from({length:10},()=>packet(0x10,voice)),
        ...Array.from({length:24},()=>packet(0x10,Buffer.alloc(320))),
      ]));
    },
    async close() {
      socket.destroy();
      await wait(30);
      bridge.close();
      await bridge.flushEvents();
      fs.rmSync(dir,{recursive:true,force:true});
    },
  };
}

function audioReply(request, ms, events = []) {
  return new Response([...events,
    {type:'pcm',sampleRate:24000,data:Buffer.alloc(48*ms,12).toString('base64')},
    {type:'done'},
  ].map(event=>JSON.stringify({...event,turnId:request.eventId})).join('\n')+'\n');
}

test('eligible silence pauses for playback and hold, and speech resets the episode', () => {
  const clock = new CustomerSilence();
  clock.tick(0,false);
  assert.equal(clock.tick(10000,false),'recover');
  assert.equal(clock.tick(25000,true),undefined);
  clock.tick(25000,false);
  clock.pause(29000);
  clock.tick(90000,false);
  assert.equal(clock.tick(91000,false),'continue');
  clock.tick(91000,false);
  assert.equal(clock.tick(95999,false),undefined);
  assert.equal(clock.tick(96000,false),'timeout');
  clock.speech();
  clock.tick(100000,false);
  assert.equal(clock.tick(110000,false),'recover');
});

test('AudioSocket silence timeout closes the direct leg while native hangup is pending', async () => {
  const actualNow = Date.now;
  let offset = 0;
  Date.now = () => actualNow()+offset;
  let probes = 0;
  let recoveryPlayback;
  const f = await fixture(request => {
    if (request.action === 'listen') return Response.json({text:++probes===1?'Hello':'',confidence:0.99});
    if (request.action === 'turn') {
      if (request.silenceStep) recoveryPlayback=request.eventId;
      return audioReply(request,request.silenceStep?600:80);
    }
    if (request.action === 'hangup') return Response.json({syncPending:true,nativeHangupPending:true});
  },{initialSilence:true});
  const hangups = () => f.requests.filter(request=>request.action==='hangup');
  try {
    f.speak();
    await until(()=>f.requests.some(request=>request.action==='playback-complete'));
    await wait(550);
    offset += 10200;
    await until(()=>recoveryPlayback);
    await until(()=>f.requests.some(request=>request.completedTurnId===recoveryPlayback&&request.action==='playback-complete'));
    await f.command('hold');
    offset += 30000;
    await wait(180);
    assert.deepEqual(hangups(),[]);
    await f.command('resume');
    await wait(180);
    offset += 5200;
    await until(()=>f.requests.some(request=>request.silenceStep===2));
    await until(()=>f.requests.some(request=>request.completedTurnId===recoveryPlayback&&request.action==='playback-complete'));
    await wait(180);
    offset += 5200;
    await until(()=>hangups().length===1);
    assert.equal(hangups()[0].endInitiation.reason,'customer_silence_timeout');
    assert.deepEqual(f.requests.filter(request=>request.silenceStep).map(request=>request.silenceStep),[1,2]);
    await until(()=>f.requests.some(request=>request.action==='ended'));
    assert.equal(f.socket.destroyed,true);
    assert.equal(hangups().length,1);
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('AudioSocket abuse requires a trusted directed transcript and bypasses turn generation', async () => {
  const {isDirectedAbuse} = require('../gateway/customer-conduct.cjs');
  for(const phrase of ['Fuck you', 'Bitch', 'Asshole', 'Okay, fuck you then.', 'Stop calling, you asshole.'])
    assert(isDirectedAbuse(phrase),phrase);
  const inputs = [
    [{text:'You are an asshole.',confidence:0.15},{text:'You are on hold.',confidence:0.99}],
    [{text:'He said “fuck you.”',confidence:0.99}],
    [{text:'This connection is shit.',confidence:0.99}],
    [{text:'Asshole.',confidence:0.15},{text:'Asshole.',confidence:0.20}],
  ];
  let replies=[],probes=0;
  const f=await fixture(request=>{
    if(request.action==='listen'){probes++;return Response.json(replies.shift()||{text:''});}
    if(request.action==='turn')return audioReply(request,80);
    if(request.action==='hangup')return Response.json({ended:true});
  });
  const hangups=()=>f.requests.filter(request=>request.action==='hangup');
  try {
    for(const input of inputs){
      replies=input.slice();
      const expected=probes+replies.length;
      f.speak();
      await until(()=>probes>=expected);
      await wait(160);
      if(input!==inputs.at(-1))assert.equal(hangups().length,0);
    }
    assert.equal(hangups().length,1);
    assert.equal(hangups()[0].endInitiation.reason,'abusive_language');
    assert(!f.requests.some(request=>request.action==='turn'&&isDirectedAbuse(request.text)));
  }finally{await f.close();}
});

test('AudioSocket pauses before STT and double-checks a misheard thank you before hanging up', async () => {
  let releaseListen;
  const firstListen = new Promise(resolve=>{releaseListen=resolve;});
  let probes=0;
  const f=await fixture(async request=>{
    if(request.action==='turn')return audioReply(request,1500);
    if(request.action==='listen'){
      if(++probes===1){await firstListen;return Response.json({text:'Thank you.',confidence:0.9});}
      return Response.json({text:'Fuck you.',confidence:0.0001});
    }
    if(request.action==='hangup')return Response.json({ended:true});
  },{first:'ai'});
  try {
    await until(()=>f.requests.some(request=>request.action==='turn'));
    await wait(120);
    f.speak();
    await until(()=>probes===1);
    await wait(1550);
    assert(!f.requests.some(request=>request.action==='playback-complete'));
    releaseListen();
    await until(()=>f.requests.some(request=>request.action==='hangup'));
    assert.equal(probes,3);
    assert.equal(f.requests.find(request=>request.action==='hangup').endInitiation.reason,'abusive_language');
  } finally {releaseListen();await f.close();}
});

test('abuse keeps AudioSocket until the native customer hangup is confirmed', async () => {
  const hangups=[];
  const f=await fixture(request=>{
    if(request.action==='listen')return Response.json({text:'Fuck you.',confidence:0.99});
    if(request.action==='hangup'){
      hangups.push(request.eventId);
      return Response.json(hangups.length===1?{hangupSubmitted:true}:{ended:true});
    }
  });
  try {
    f.speak();
    await until(()=>hangups.length===1);
    assert(!f.socket.destroyed);
    await until(()=>f.socket.destroyed);
    assert.deepEqual(hangups,[hangups[0],hangups[0]]);
  } finally {await f.close();}
});

test('transfer follow-up replaces the announcement before commitment without extending the 90-second deadline', async()=>{
  const actualNow=Date.now;
  let offset=0;
  Date.now=()=>actualNow()+offset;
  const origin=actualNow();
  let announcement, followup, probes=0;
  const f=await fixture(request=>{
    if(request.action==='call-state')return Response.json({connectedAt:new Date(origin).toISOString(),businessQuestionCount:2});
    if(request.action==='listen')return Response.json({text:['Hello','Who is the specialist?','No, do not transfer me'][probes++],confidence:0.99});
    if(request.action==='turn'){
      if(!announcement)announcement=request.eventId;
      else if(!followup)followup=request;
      if(probes===3)return new Response(JSON.stringify({type:"done",turnId:request.eventId})+"\n");
      return audioReply(request,1200,[{type:'handoff-announcement'}]);
    }
    if(request.action==='hangup')return Response.json({ended:true});
  });
  try {
    await until(()=>f.requests.some(request=>request.action==='call-state'));
    f.speak();
    await until(()=>announcement);
    await wait(170);
    f.speak();
    await until(()=>followup);
    assert.equal(followup.interruptedHandoff,announcement);
    await wait(170);
    f.speak();
    await until(()=>f.requests.filter(request=>request.interruptedHandoff).length===2);
    assert(!f.requests.some(request=>request.action==='playback-complete'&&request.completedTurnId===announcement));
    await wait(1450);
    offset += origin+89900-Date.now();
    offset += 250;
    await until(()=>f.requests.some(request=>request.endInitiation?.reason==='script_duration_limit'));
  }finally{
    Date.now=actualNow;
    await f.close();
  }
});

test('absolute deadline survives playback, echo, native rejection and delayed confirmation', async () => {
  const actualNow = Date.now;
  let offset = 0;
  const origin = actualNow() - 5000;
  Date.now = () => actualNow() + offset;
  let attempts = 0;
  const f = await fixture(request => {
    if (request.action === 'turn') return audioReply(request,4800,[{type:'delta',text:'This is the agent speaking'}]);
    if (request.action === 'listen') return Response.json({text:'This is the agent speaking',confidence:0.99});
    if (request.action === 'hangup') {
      attempts++;
      if (attempts === 1) return Response.json({}, {status:503});
      if (attempts === 2) throw Error('fixture transport timeout');
      if (attempts === 3) return Response.json({saved:true,hangupSubmitted:true,syncPending:true});
      return Response.json({ended:true});
    }
  },{first:'ai',initialSilence:true,score:0.4,connectedAt:new Date(origin).toISOString()});
  try {
    await wait(250);
    f.speak(); // Playback overlap and the same transcript as the agent output.
    await until(()=>f.requests.some(request=>request.action==='listen'));
    await wait(120);
    offset += origin + 30100 - Date.now();
    await until(()=>attempts===1);
    assert.equal(f.socket.destroyed,false);
    assert.equal(f.requests.filter(request=>request.action==='turn').length,1);
    for (let expected=2;expected<=4;expected++) {
      offset += 11000;
      await until(()=>attempts===expected);
      if (expected<4) assert.equal(f.socket.destroyed,false);
    }
    const hangups=f.requests.filter(request=>request.action==='hangup');
    assert.equal(new Set(hangups.map(request=>request.eventId)).size,1);
    assert.equal(new Set(hangups.map(request=>request.callId)).size,1);
    assert.equal(hangups[0].endInitiation.reason,'no_customer_speech_deadline');
    assert.match(hangups[0].endInitiation.evidence,/origin=connected_at/);
    await until(()=>f.socket.destroyed);
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('quiet Silero-confirmed speech protects the call even without a transcript', async () => {
  const actualNow = Date.now;
  let offset = 0;
  Date.now = () => actualNow() + offset;
  const f = await fixture(()=>undefined,{initialSilence:true,score:0.27});
  try {
    const quiet = Buffer.alloc(320);
    for(let i=0;i<320;i+=2) quiet.writeInt16LE(2900*Math.sin(i/10),i);
    offset += 7800;
    f.pcm(quiet,8);
    await wait(200);
    offset += 91000;
    await wait(220);
    assert(!f.requests.some(request=>request.action==='hangup'));
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('speech already being recognized at the customer-first cutoff can keep the call open', async () => {
  const actualNow = Date.now;
  const origin = actualNow();
  let offset = 0;
  let releaseListen;
  const recognition = new Promise(resolve => { releaseListen = resolve; });
  Date.now = () => actualNow() + offset;
  const f = await fixture(async request => {
    if (request.action === 'listen') {
      await recognition;
      return Response.json({text:'Hello there',confidence:0.99});
    }
    if (request.action === 'turn') return audioReply(request,80);
    if (request.action === 'hangup') return Response.json({ended:true});
  }, {connectedAt:new Date(origin).toISOString()});
  try {
    offset += 9300 - (Date.now()-origin);
    f.speak();
    await until(() => f.requests.some(request => request.action === 'listen'));
    offset += 10100 - (Date.now()-origin);
    await wait(160);
    assert(!f.requests.some(request => request.action === 'hangup'));
    releaseListen();
    await until(() => f.requests.some(request => request.action === 'playback-complete'));
    assert(!f.requests.some(request => request.action === 'hangup'));
  } finally {
    releaseListen();
    Date.now = actualNow;
    await f.close();
  }
});

test('continuous digital silence triggers the initial native hangup reason', async () => {
  const actualNow = Date.now;
  const started = actualNow();
  let elapsed = 0;
  Date.now = () => started + elapsed;
  const f = await fixture(request=>{
    if(request.action==='hangup')return Response.json({ended:true});
  },{first:"ai",initialSilence:true});
  try {
    for(let i=0;i<60;i++){
      elapsed = i === 59 ? 29900 : i * 500;
      f.pcm(Buffer.alloc(320),25);
      await wait(22);
    }
    assert(!f.requests.some(request=>request.action==='hangup'));
    elapsed = 30050;
    await until(()=>f.requests.some(request=>request.action==='hangup'));
    assert.equal(f.requests.find(request=>request.action==='hangup').endInitiation.reason,'initial_no_speech_timeout');
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('a verified short acknowledgment reaches the worker after playback with one corroboration and a bounded BUSY retry', async () => {
  let listens=0, attempts=0;
  const f=await fixture(request=>{
    if(request.action==='listen')return Response.json(++listens===1?
      {text:'Hello there',confidence:0.98}:{text:'Okay.',confidence:0.02});
    if(request.action==='turn'){
      if(request.text==='Okay.'&&++attempts===1)
        return Response.json({code:'BUSY'},{status:409});
      return audioReply(request,80);
    }
  },{initialSilence:true,score:0.6});
  try {
    f.speak();
    await until(()=>f.requests.some(request=>request.action==='playback-complete'));
    await wait(160);
    f.speak();
    await until(()=>attempts===2);
    assert.equal(listens,3);
    await until(()=>f.requests.filter(request=>request.action==='playback-complete').length===2);
    assert.equal(attempts,2);
  } finally {
    await f.close();
  }
});

test('three-question absolute limit still runs while held after a recorded answer', async () => {
  const actualNow=Date.now;
  let offset=0;
  const origin=actualNow();
  let entered=false;
  Date.now=()=>actualNow()+offset;
  const f=await fixture(request=>{
    if(request.action==='listen')return Response.json({text:'Yes',confidence:0.98});
    if(request.action==='turn'){entered=true;return audioReply(request,80,[{type:'business-outcome'}]);}
    if(request.action==='call-state')return Response.json({connectedAt:new Date(origin).toISOString(),businessQuestionCount:3,businessOutcome:true});
    if(request.action==='hangup')return Response.json({ended:true});
  },{initialSilence:true,score:0.6});
  try {
    f.speak();
    await until(()=>entered&&f.requests.some(request=>request.action==='call-state'));
    await f.command('hold');
    offset+=119500-(Date.now()-origin);
    await wait(150);
    assert(!f.requests.some(request=>request.action==='hangup'));
    offset+=600;
    await until(()=>f.requests.some(request=>request.action==='hangup'));
    const requested=f.requests.find(request=>request.action==='hangup');
    assert.equal(requested.endInitiation.reason,'script_duration_limit');
    assert.match(requested.endInitiation.evidence,/limit_s=120; origin=connected_at/);
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('a short-script deadline aborts generation that has not delivered any PCM', async () => {
  const actualNow=Date.now;
  const origin=actualNow();
  let offset=0, signal;
  Date.now=()=>actualNow()+offset;
  const f=await fixture((request,init)=>{
    if(request.action==='listen')return Response.json({text:'Yes',confidence:0.98});
    if(request.action==='turn'){
      signal=init.signal;
      return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }
    if(request.action==='call-state')return Response.json({connectedAt:new Date(origin).toISOString(),businessQuestionCount:1,businessOutcome:true});
    if(request.action==='hangup')return Response.json({ended:true});
  },{initialSilence:true,score:0.6});
  try {
    f.speak();
    await until(()=>signal&&f.requests.some(request=>request.action==='call-state'));
    assert.equal(signal.aborted,false);
    offset+=90050-(Date.now()-origin);
    await until(()=>f.requests.some(request=>request.endInitiation?.reason==='script_duration_limit'));
    assert.equal(signal.aborted,true);
  } finally {
    Date.now=actualNow;
    await f.close();
  }
});

test('customer-first silence plays one intro at eight seconds and requests hangup at ten', async () => {
  const actualNow = Date.now;
  let now = actualNow();
  Date.now = () => now;
  const f = await fixture(request => {
    if (request.action === 'turn') return audioReply(request, 80);
    if (request.action === 'hangup') return Response.json({ended:true});
  });
  try {
    const turns = () => f.requests.filter(request => request.action === 'turn');
    const hangups = () => f.requests.filter(request => request.action === 'hangup');
    now += 7999;
    await wait(150);
    assert.equal(turns().length, 0);
    now++;
    await until(() => f.requests.some(request => request.action === 'playback-complete'));
    assert.equal(turns().length, 1);
    assert.equal(turns()[0].opening, true);
    assert.equal(turns()[0].silenceOpening, true);
    now += 1999;
    await wait(150);
    assert.equal(turns().length, 1);
    assert.equal(hangups().length, 0);
    now++;
    await until(() => hangups().length === 1);
    assert.equal(hangups()[0].endInitiation.reason, 'no_customer_speech_deadline');
  } finally {
    Date.now = actualNow;
    await f.close();
  }
});
