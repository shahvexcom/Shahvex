const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {conductDecision}=require('../gateway/customer-conduct.cjs');
const {ConversationSilence}=require('../gateway/conversation-silence.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
const ends=['hangup','hang-up','hang up now','end the call','end the call now','end the calll now','hangout','hangout the call','hangup end the call','Hangout.','Hangout the call?','End the calll now.'];
test('requested end phrases get one invitation, then a silent immediate end',()=>{
 for(const text of ends){assert.equal(conductDecision(text,false,false).kind,'offer',text);const next=conductDecision(text,false,true);assert.equal(next.immediate,true,text);assert.equal(next.text,'',text);}
 assert.equal(conductDecision('I hangout with my friends',false,false),null);
});
test('each quiet window triggers at three seconds, excluding playback',()=>{
 const timer=new ConversationSilence();let now=0;
 for(let i=1;i<=4;i++){timer.tick(now,false);assert.equal(timer.tick(now+2999,false),undefined);assert.equal(timer.tick(now+3000,false),i);timer.tick(now+3100,true);now+=4000;}
});
function loadControls(call,events,response='SUCCESS: ra_call_control'){
 const deps={'./database':{db:async()=>({query:async(sql,args)=>{events.push({sql,args});return {rows:[call],rowCount:1};}})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial':{vicidialRequest:async(_s,_u,_p,value)=>{events.push(value);return response;},requireVicidialSuccess:value=>{if(!value.startsWith('SUCCESS:'))throw Error('Native command rejected');}},'./vicidial-config':{vicidialLiveConfig:{parse:x=>x}},'./vicidial-bridge':{requestBridge:async(_u,_s,_p,value)=>{events.push(value);return {accepted:true};}},'./vicidial-results':{}};
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-controls.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n],m,m.exports);return m.exports;
}
test('linked audio hangup sends native HANGUP for the exact customer and closes AI audio',async()=>{
 const events=[],call={id:'call',status:'ANSWERED',telephony_provider:'AUDIOSOCKET',vicidial_call_id:'exact-customer',vicidial_agent_user:'78618',live_config:{bridgeUrl:'bridge'},secret_ciphertext:'secret',bridge_secret_ciphertext:'bridge-secret'};
 const r=await loadControls(call,events).vicidialCallCommand('call','hangup');assert.equal(r.status,200);
 assert(events.some(e=>e.function==='ra_call_control'&&e.stage==='HANGUP'&&e.value==='exact-customer'));
 assert(events.some(e=>e.action==='close-audio'));
 const retry=[];const again=await loadControls({...call,status:'COMPLETED'},retry,'ERROR: no active call found').vicidialCallCommand('call','hangup',undefined,false,true);assert.equal(again.status,409);assert(!retry.some(e=>e.stage==='HANGUP'||e.action==='close-audio'));
});
test('the normal tester resumes the saved business question for listening replies after the hangup invitation',async()=>{
 const original=global.fetch;global.fetch=async(url)=>String(url).includes('11434')?new Response(JSON.stringify({message:{content:'Do you own the home?'},done:true})+'\n'):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const secret='three-second-hangup-fixture-'.repeat(3),service=createTesterService({secret,testHooks:true});let id;
 const req=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'hangup-flow','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async text=>{const r=await service.dispatch(req('turn',{text}));assert.equal(r.status,200);const events=(await r.text()).trim().split('\n').map(JSON.parse);assert(!events.some(e=>e.type==='error'));return events;};
 try{
  for(const reply of ['Yes','Yep','Hmm','Hello','Okay','Go ahead','Absolutely','Sure thing']){
   id=(await(await service.dispatch(req('start',{agentId:'hangup-agent',config:{name:'Alex',voice:'hangup-voice',first:'customer',goal:'Discuss home repairs',task:'Ask about home ownership',instructions:'',script:'Are you the homeowner?',knowledge:'',style:'Natural'}}))).json()).id;
   service.sessionStore.get(id).messages.push({role:'assistant',content:'Are you the homeowner?'});
   const offer=await turn('End the call now');assert.match(offer.filter(e=>e.type==='delta').map(e=>e.text).join(''),/^Sir, .*two minutes/);assert(!offer.some(e=>e.type==='end_call'));
   const resumed=await turn(reply);assert.equal(resumed.filter(e=>e.type==='delta').map(e=>e.text).join(''),'Sir, Do you own the home?',reply);assert(!resumed.some(e=>e.type==='end_call'));
   const ending=await turn('Hangout');assert(ending.some(e=>e.type==='end_call'&&e.immediate));assert(!ending.some(e=>e.type==='pcm'||e.type==='delta'));
   await service.dispatch(req('stop',{}));id=undefined;
  }
 }finally{if(id)await service.dispatch(req('stop',{}));global.fetch=original;}
});
