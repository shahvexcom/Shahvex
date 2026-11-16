const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {createTesterService}=require('../gateway/tester-service.cjs');
const mod={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync('lib/conversation-silence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod,require);
const {ConversationSilence}=mod.exports;

test('listening windows are 5s, 4s, 3s goodbye, then 5s before hangup',()=>{
 const timer=new ConversationSilence();let start=0;
 for(const [i,delay]of [5000,4000,3000,5000].entries()){assert.equal(timer.tick(start,false),undefined);assert.equal(timer.tick(start+delay-1,false),undefined);assert.equal(timer.tick(start+delay,false),i+1);timer.tick(start+delay+1,true);start+=delay+1000;}
 assert.equal(timer.tick(100000,false),undefined);
});
test('playback does not consume the next listening window',()=>{const timer=new ConversationSilence();timer.tick(0,false);timer.tick(4000,true);assert.equal(timer.tick(40000,true),undefined);assert.equal(timer.tick(50000,false),undefined);assert.equal(timer.tick(54999,false),undefined);assert.equal(timer.tick(55000,false),1);});
test('speech resets reminders and cancels the final hangup countdown',()=>{const timer=new ConversationSilence();let start=0;for(const delay of [5000,4000,3000]){timer.tick(start,false);timer.tick(start+delay,false);start+=delay+100;}timer.tick(start,false);timer.speech();assert.equal(timer.tick(start+4500,false),undefined);assert.equal(timer.tick(start+9500,false),1);});

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
    for(let step=1;step<=3;step++){
      const result=await events(await dispatch(req('turn',id,{silenceStep:step})));
      assert.ok(!result.some(e=>e.type==='user'||e.type==='error'));
      assert.ok(result.some(e=>e.type==='pcm'));
      assert.equal(result.filter(e=>e.type==='end_call').length,step===3?1:0);
      assert.equal(result.at(-1).type,'done');
    }
    assert.equal(new Set(spoken).size,3);
    assert.deepEqual(spoken.slice(0,2),['Are you still there?','Can you hear me?']);assert.match(spoken[2],/Goodbye/);
    assert.ok(!sessionStore.get(id).messages.some(m=>m.role==='user'));
    for(const body of [{silenceStep:4},{silenceStep:1,text:'yes'},{silenceStep:1,opening:true}]){
      const result=await events(await dispatch(req('turn',id,body)));
      assert.ok(result.some(e=>e.type==='error'));
      assert.ok(!result.some(e=>e.type==='pcm'||e.type==='end_call'));
    }
    assert.equal(spoken.length,3);
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
    const response=await dispatch(req('turn',id,{silenceStep:3}));
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
