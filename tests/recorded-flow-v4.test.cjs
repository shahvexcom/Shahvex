const {test}=require('node:test');
const assert=require('node:assert/strict');
const {repairTurn,FLOW_REVISION}=require('../gateway/conversation-resume.cjs');
const {recoveryReply}=require('../gateway/conversation-recovery.cjs');
const {createTesterService}=require('../gateway/tester-service.cjs');
test('recorded greetings and hangup requests never become missing-question clarification',()=>{
 for(const text of ['Hello?','Hello hello','Hmm','Okay','End the call now','No'])assert.equal(recoveryReply([{role:'user',content:text}]),'');
 assert.equal(recoveryReply([{role:'user',content:'Why are you calling?'}]),'Please repeat your last question.');
});
test('repeated greetings keep the pending question without restarting the purpose',()=>{
 const history=[{role:'assistant',content:'I am calling about repairs. What needs fixing?'}];
 assert.deepEqual(repairTurn('Hello hello',history,'',true),{kind:'question',source:'What needs fixing?'});
});
test('native intro uses playback acknowledgment, rejects stale acknowledgment, then advances to purpose',async()=>{
 const original=global.fetch,secret='v4-native-fixture-'.repeat(4);let models=0,id;
 global.fetch=async url=>String(url).includes('11434')?(models++,new Response(JSON.stringify({message:{content:'I am calling about your home repair needs. What repair do you need?'},done:true})+'\n')):new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const service=createTesterService({secret,testHooks:true});
 const request=(action,body)=>new Request('http://fixture/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'v4-owner','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});
 const turn=async body=>{const r=await service.dispatch(request('turn',body));assert.equal(r.status,200);const events=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.filter(e=>e.type==='error'),[]);return {text:events.filter(e=>e.type==='delta').map(e=>e.text).join(''),id:events.find(e=>e.type==='done').turnId};};
 try{
 const started=await(await service.dispatch(request('start',{agentId:'v4-agent',requirePlaybackAck:true,config:{name:'Alex',voice:'v4-native-voice',first:'ai',goal:'Discuss home repairs',task:'Ask about repairs',instructions:'',script:'This is Alex from Repairs. Ask what repair the customer needs.',knowledge:'',style:'Natural'}}))).json();id=started.id;assert.equal(started.flowRevision,FLOW_REVISION);
 const opening=await turn({text:"Hello hello"});
 const restart=await turn({text:'Hello hello'});assert.match(restart.text,/Alex.*Repairs/);assert.notEqual(restart.text,opening.text);assert.equal(models,0);
 await service.dispatch(request('playback-complete',{completedTurnId:opening.id}));assert.equal(service.sessionStore.get(id).introPlaybackComplete,false);
 await service.dispatch(request('playback-complete',{completedTurnId:restart.id}));assert.equal(service.sessionStore.get(id).introPlaybackComplete,true);
 const purpose=await turn({text:'Hmm'});assert.match(purpose.text,/calling about your home repair/);assert.equal(models,1);
 }finally{if(id)await service.dispatch(request('stop',{}));global.fetch=original;}
});
