const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {createTesterService}=require('../gateway/tester-service.cjs');
const mod={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync('lib/conversation-silence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports,mod);
const {ConversationSilence}=mod.exports;

test('three checks each allow ten seconds, then another ten seconds before goodbye',()=>{
  const timer=new ConversationSilence();
  for(let step=1;step<=4;step++){
    const start=(step-1)*15000;
    assert.equal(timer.tick(start,false),undefined);
    assert.equal(timer.tick(start+9999,false),undefined);
    assert.equal(timer.tick(start+10000,false),step);
    assert.equal(timer.tick(start+10001,true),undefined); // synthesis/playback
  }
  assert.equal(timer.tick(100000,false),undefined);
  assert.equal(timer.tick(200000,false),undefined);
});

test('playback, processing, mute and suspension pause the listening window',()=>{
  const timer=new ConversationSilence();
  timer.tick(0,false);timer.tick(9000,true);
  assert.equal(timer.tick(40000,true),undefined);
  assert.equal(timer.tick(50000,false),undefined);
  assert.equal(timer.tick(59999,false),undefined);
  assert.equal(timer.tick(60000,false),1);
});

test('customer speech and a new session reset all previous attempts',()=>{
  const timer=new ConversationSilence();
  timer.tick(0,false);assert.equal(timer.tick(10000,false),1);
  timer.tick(11000,false);assert.equal(timer.tick(21000,false),2);
  timer.speech();timer.tick(22000,false);
  assert.equal(timer.tick(32000,false),1);
  timer.reset();timer.tick(33000,false);
  assert.equal(timer.tick(43000,false),1);
});

const secret='silence-test-secret-'.repeat(3);
const config={name:'Jenifer',voice:'voice',first:'ai',goal:'Review options',task:'Ask about coverage',instructions:'',script:'Jenifer from Shahvex',knowledge:'',style:'Natural'};
function req(action,id,body){return new Request('http://local/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'silence-tests','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});}
const events=async r=>(await r.text()).trim().split('\n').map(JSON.parse);

test('presence checks use the selected voice without model inference or fake customer messages; final check signals closure',async()=>{
  const original=global.fetch,spoken=[];
  global.fetch=async(url,init)=>{
    assert.ok(!String(url).includes('11434'),'silence must not invoke the model');
    const body=JSON.parse(init.body);assert.equal(body.voice_id,'voice');spoken.push(body.text);
    return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
  };
  const {dispatch,sessionStore}=createTesterService({secret,testHooks:true});let id;
  try{
    id=(await(await dispatch(req('start',null,{agentId:'a',config}))).json()).id;
    for(let step=1;step<=4;step++){
      const result=await events(await dispatch(req('turn',id,{silenceStep:step})));
      assert.ok(!result.some(e=>e.type==='user'||e.type==='error'));
      assert.ok(result.some(e=>e.type==='pcm'));
      assert.equal(result.filter(e=>e.type==='end_call').length,step===4?1:0);
      assert.equal(result.at(-1).type,'done');
    }
    assert.equal(new Set(spoken).size,4);
    assert.deepEqual(spoken.slice(0,3),['Are you still there?','Can you hear me?','Are you available to continue?']);
    assert.ok(!sessionStore.get(id).messages.some(m=>m.role==='user'));
    for(const body of [{silenceStep:5},{silenceStep:1,text:'yes'},{silenceStep:1,opening:true}]){
      const result=await events(await dispatch(req('turn',id,body)));
      assert.ok(result.some(e=>e.type==='error'));
      assert.ok(!result.some(e=>e.type==='pcm'||e.type==='end_call'));
    }
    assert.equal(spoken.length,4);
    await dispatch(req('stop',id,{}));assert.equal(sessionStore.has(id),false);
  }finally{if(id)await dispatch(req('stop',id,{}));global.fetch=original;}
});

test('customer interruption cancels a pending silence goodbye without emitting a hangup event',async()=>{
  const original=global.fetch;let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  global.fetch=async(url,init)=>{entered();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};
  const {dispatch}=createTesterService({secret});let id;
  try{
    id=(await(await dispatch(req('start',null,{agentId:'a',config}))).json()).id;
    const response=await dispatch(req('turn',id,{silenceStep:4}));
    await started;
    await dispatch(req('interrupt',id,{}));
    const result=await events(response);
    assert.ok(!result.some(e=>e.type==='end_call'||e.type==='pcm'));
  }finally{if(id)await dispatch(req('stop',id,{}));global.fetch=original;}
});

test('unrecognized validated speech asks for clarification without inventing a transcript',async()=>{
  const original=global.fetch;
  global.fetch=async(url,init)=>{
    if(String(url).includes('8766'))return Response.json({text:''});
    assert.ok(!String(url).includes('11434'));
    assert.match(JSON.parse(init.body).text,/Could you say it again/);
    return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
  };
  const {dispatch,sessionStore}=createTesterService({secret,testHooks:true});let id;
  try{
    id=(await(await dispatch(req('start',null,{agentId:'a',config}))).json()).id;
    const wav=Buffer.alloc(44+12800);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(12800,40);
    for(let i=0;i<6400;i++)wav.writeInt16LE(Math.round(4000*Math.sin(i*.1)),44+i*2);
    const request=req('turn',id,{});
    request.headers.set('content-type','audio/wav');
    const result=await events(await dispatch(new Request(request.url,{method:'POST',headers:request.headers,body:wav})));
    assert.ok(result.some(e=>e.type==='delta'&&e.text.includes("didn't catch")));
    assert.ok(result.some(e=>e.type==='pcm'));
    assert.ok(!result.some(e=>e.type==='user'||e.type==='error'||e.type==='end_call'));
    assert.ok(!sessionStore.get(id).messages.some(m=>m.role==='user'));
  }finally{if(id)await dispatch(req('stop',id,{}));global.fetch=original;}
});
