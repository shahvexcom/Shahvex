const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {rememberQuestions}=require('../gateway/question-memory.cjs');
const q1='Are you currently getting any rebate or money back on a card each month?',q2='Do you currently have Medicare Part A or Part B or Medicaid?';
function load(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='zod'?require('zod'):n.startsWith('node:')?require(n):{},m,m.exports);return m.exports;}
test('actual signed fast-listen callback forwards final-turn flag, session, owner and stable turn ID',async()=>{
 const conn=crypto.randomUUID(),callId=crypto.randomUUID(),eventId=crypto.randomUUID();let got;const previous=process.env.SHAHVEX_PC_AI_URL;process.env.SHAHVEX_PC_AI_URL='https://fixture.invalid';
 const callback=load('lib/vicidial-callback.ts',{'./database':{db:async()=>({query:async sql=>({rows:[sql.includes('voip_connections')?{id:conn,bridge_secret_ciphertext:'secret',secret_ciphertext:'secret',enabled:true,live_config:{enabled:true}}:{id:callId,status:'ANSWERED',transfer_status:'NONE',voice_session_id:'voice-session',vicidial_call_id:'Y20260000001234567890'}]})})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-bridge':{verifyBridgeSignature:()=>true},'./vicidial-config':{vicidialLiveConfig:{parse:x=>x}},'./pc-ai-engine':{pcAiRequest:async(path,init,owner)=>{got={path,init,owner};return Response.json({text:'Hello',completion:'complete'});}}});
 try{const response=await callback.vicidialCallback(new Request('https://fixture.invalid/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':conn},body:JSON.stringify({action:'listen',eventId,externalCallId:'Y20260000001234567890',callId,audio:Buffer.alloc(80).toString('base64'),turnFinal:true})}));assert.equal(response.status,200);assert.equal(got.path,'/tester/listen');assert.equal(got.init.headers['x-shahvex-turn-final'],'1');assert.equal(got.init.headers['x-shahvex-turn'],eventId);assert.equal(got.owner,'vici-'+callId);}finally{if(previous===undefined)delete process.env.SHAHVEX_PC_AI_URL;else process.env.SHAHVEX_PC_AI_URL=previous;}
});
test('PC playback acknowledgment is supported and response worker revision survives forwarding',async()=>{
 const names=['SHAHVEX_PC_AI_URL','SHAHVEX_PC_AI_SECRET','SHAHVEX_CF_CLIENT_ID','SHAHVEX_CF_CLIENT_SECRET'],old=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetch=global.fetch;
 Object.assign(process.env,{SHAHVEX_PC_AI_URL:'https://fixture.invalid',SHAHVEX_PC_AI_SECRET:'x'.repeat(40),SHAHVEX_CF_CLIENT_ID:'id',SHAHVEX_CF_CLIENT_SECRET:'secret'});
 const pc=load('lib/pc-ai-engine.ts',{});global.fetch=async(url,init)=>{assert.equal(url.pathname,'/tester/playback-complete');assert.equal(init.headers.get('x-shahvex-owner'),'owner');return Response.json({saved:true},{headers:{'x-shahvex-flow-revision':'fixture-revision'}});};
 try{const response=await pc.pcAiRequest('/tester/playback-complete',{method:'POST',body:'{}'},'owner');assert.equal(response.headers.get('x-shahvex-flow-revision'),'fixture-revision');}finally{global.fetch=fetch;for(const n of names)if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}
});
test('health side questions answer accurately and resume the pending question without becoming lead answers',async()=>{
 const original=global.fetch,secret='v8-side-fixture-'.repeat(4);let id;
 global.fetch=async url=>String(url).includes('11434')?new Response(JSON.stringify({message:{content:'Regular physical activity can support general health.'},done:true})+'\n'):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v8-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async text=>{const r=await service.dispatch(request('turn',{text}));assert.equal(r.status,200);const e=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(e.filter(v=>v.type==='error'),[]);return {events:e,text:e.filter(v=>v.type==='delta').map(v=>v.text).join('')};};
 try{
 id=(await(await service.dispatch(request('start',{agentId:'v8-agent',config:{name:'Alex',voice:'v8-side',first:'customer',goal:'Discuss coverage review',task:'Ask questions',instructions:'',script:'Hi, this is Alex from the Wellness Team.\n'+q1+'\n'+q2,knowledge:'',style:'Natural'}}))).json()).id;
 const session=service.sessionStore.get(id);session.messages.push({role:'assistant',content:q1});session.purposeDelivered=true;
 const alcohol=await turn('Are you drunk?');assert.match(alcohol.text,/No, I don't drink alcohol.*liver.*rebate/s);assert.doesNotMatch(alcohol.text,/mainly.*lungs|I drank|I had alcohol/i);assert(alcohol.events.some(e=>e.type==='user'&&e.conversationOnly));assert.equal(rememberQuestions(session.messages).completed.length,0);
 const next=await turn('No.');assert.match(next.text,/Part A/);
 const meal=await turn("I'm eating breakfast.");assert.match(meal.text,/take your time.*If you have a moment.*Part A/s);assert.doesNotMatch(meal.text,/I (?:ate|had|have eaten)/i);assert.equal(rememberQuestions(session.messages).completed.length,1);
 const smoke=await turn('Do you smoke?');assert.match(smoke.text,/don't smoke.*lungs.*Part A/s);
 const general=await turn('Is exercise healthy?');assert.match(general.text,/physical activity.*Part A/s);assert.equal(rememberQuestions(session.messages).completed.length,1);
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});

test('native partial lead fields never treat a marked side statement as a qualification answer',()=>{
 const results=load('lib/vicidial-results.ts',{});
 const history=[{role:'assistant',content:'Do you have Medicaid?'},{role:'user',content:"I'm eating breakfast.",conversationOnly:true}];
 assert.deepEqual(results.partialHandoffFields(history),{});
 assert.deepEqual(results.groundedCallFields({fields:[{name:'coverage',value:'breakfast',evidence:"I'm eating breakfast."}]},history),{});
});
