const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),{createRequire}=require('node:module');
const intent=require('../gateway/handoff-intent.cjs');
function load(file,deps={}){const filename=path.resolve(file),req=createRequire(filename),m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(raw=>{const n=raw.replace(/\.ts$/,'');return Object.hasOwn(deps,n)?deps[n]:n==='server-only'?{}:n.startsWith('./')&&fs.existsSync(path.resolve(path.dirname(filename),n+'.ts'))?load(path.resolve(path.dirname(filename),n+'.ts'),deps):req(n)},m,m.exports);return m.exports;}
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
function results(query=async()=>({rowCount:1,rows:[]})){return load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{db:async()=>({query})},'./credential-crypto':{},'./vicidial':{},'./agent-runtime':{},'./vicidial-bridge':{},'./vicidial-config':{}});}
test('direct requests, including giving details to the licensed member, are recognized without treating hypotheticals or refusals as consent',()=>{
 for(const text of ['Transfer me.','Please transfer me now.','Connect my call to a licensed agent.','I want to speak to a licensed person.',"I'll give my details to the licensed member.",'Can I talk with a specialist?','I would rather share my information with the human agent.'])assert.equal(intent.customerRequestsHuman(text),true,text);
 for(const text of ["Don't transfer me.",'I do not want to speak to a human.','If I answer you, will you transfer me?','What is a licensed person?','He said transfer me.','Yes.'])assert.equal(intent.customerRequestsHuman(text),false,text);
});
test('partial answers stay verbatim, missing answers remain absent and social questions never become lead facts',async()=>{
 const r=results();const history=[A('What is your age?'),U('I am 67.'),A('Do you have Medicaid?'),U('Are you married?'),A("Let's get back to helping you."),U('No.'),U('Transfer me.')];
 const fields=r.partialHandoffFields(history);assert.equal(fields.age.value,'I am 67.');assert.equal(fields.Medicaid.value,'No.');assert.equal(Object.keys(fields).length,2);
 assert.deepEqual(r.partialHandoffFields([A('What is your age?'),U('I want to marry you.'),U('Transfer me.')]),{});
});
test('zero, partial and full answer sets use requested-human mode without a qualification model and preserve prior fields',async()=>{
 for(const history of [[U('Transfer me.')],[A('What is your age?'),U('67'),U('Transfer me.')],[A('What is your age?'),U('67'),A('Which state?'),U('Arizona'),U('Transfer me.')]]){
  let saved;const r=results(async(sql,args)=>{saved={sql,args};return {rowCount:1}});
  await r.prepareRequestedHumanHandoff('call',history,{script:'Ask age and state.'});const audit=JSON.parse(saved.args[0]);
  assert.equal(audit.mode,'CUSTOMER_REQUESTED_HUMAN');assert.equal(audit.goalAchieved,false);assert.equal(audit.handoffReady,true);assert.match(saved.sql,/collected_fields=collected_fields \|\|/);
  assert.equal(Object.keys(JSON.parse(saved.args[3])).length,history.filter(t=>t.role==='assistant').length);
  await r.prepareRequestedHumanHandoff('call',history,{script:'Ask age and state.'},audit);assert.equal(JSON.parse(saved.args[0]).handoffNotes.length,1);
 }
});
test('explicit acceptance of a transfer offer prepares fast handoff; unrelated yes does not',async()=>{
 let writes=0,saved;const r=results(async(sql,args)=>{writes++;saved=JSON.parse(args[0]);return {rowCount:1};});
 for(const answer of ['Okay.','Yes.','Go ahead.']){const history=[A('May I connect you with a licensed specialist?'),U(answer)];await r.prepareRequestedHumanHandoff('call',history,{});assert.equal(saved.mode,'CUSTOMER_ACCEPTED_HANDOFF');assert.equal(saved.handoffReady,true);assert.equal(r.hasCurrentQualification({qualification:saved,script_snapshot:{},conversation_history:history}),true);}
 const before=writes;await assert.rejects(r.prepareRequestedHumanHandoff('call',[A('Can you hear me?'),U('Yes.')],{}),/No current customer consent/);assert.equal(writes,before);
});
test('waiting gets one acknowledgment, one status and then silence, never a false connection claim',()=>{
 const {transferAcknowledgment:reply}=load('lib/agent-context-answer.ts');let history=[U('Transfer me.')];
 const first=reply('Transfer me.',[]);assert.equal(first,'Alright, please wait.');history.push(A(first));
 const second=reply('Okay, I am waiting.',history);assert.equal(second,'');history.push(U('Okay, I am waiting.'),A(second));
 for(let i=0;i<4;i++){assert.equal(reply('I am still waiting.',history),'');history.push(U('I am still waiting.'));}
 const status=reply('Have you transferred me?',history);assert.equal(status,"I don't have confirmation of a completed transfer yet.");
 assert.equal(reply('Have you transferred me?',[...history,A(status)]),'');
 assert.equal(reply('Yes.',[A('I can transfer you later. Are you over 65?')]),undefined);
 assert.equal(reply('Okay.',[U('Transfer me.'),A(first),U("Don't transfer me."),A('Understood.')]),undefined);
});

test('requested handoff starts while lead sync is pending; a sync failure does not replace it with more qualification',async()=>{
 for(const [fails,acceptedOffer] of [[false,false],[true,false],['pending',false],['pending',true]]){
  let syncStarted=false,transfers=0,resolveSync;
  const call={id:crypto.randomUUID(),status:'ANSWERED',conversation_busy:false,conversation_history:acceptedOffer?[A('May I connect you with a specialist?'),U('Okay.')]:[U('Transfer me.')],script_snapshot:{script:'Ask age then state.'},qualification:{},transfer_status:''};
  const c={id:crypto.randomUUID(),enabled:true,bridge_secret_ciphertext:'bridge-secret',secret_ciphertext:'dialer-secret',live_config:{enabled:true}};
  const query=async(sql)=>{if(sql.startsWith('SELECT * FROM voip_connections'))return {rows:[c]};if(sql.startsWith('INSERT INTO vicidial_events'))return {rowCount:1,rows:[{}]};if(sql.startsWith('SELECT transfer_status'))return {rows:[{transfer_status:call.transfer_status}]};if(sql.startsWith('SELECT * FROM agent_calls'))return {rows:[call]};return {rowCount:1,rows:[]};};
  const deps={'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':{verifyBridgeSignature:()=>true},'./vicidial':{},'./vicidial-config':{vicidialLiveConfig:{parse:v=>v}},'./agent-test':{},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-queue':{},'./vicidial-recording':{},'./agent-runtime':{},'./vicidial-handoff':{},'./bpo-entitlements':{},'./vicidial-results':{
   hasTransferConsent:()=>true,hasRequestedHumanHandoff:()=>!acceptedOffer,conversationHash:()=>'',qualificationHash:()=>'',prepareRequestedHumanHandoff:async()=>({consent:true,handoffReady:true}),collectVicidialResult:async()=>{throw Error('Must not run qualification extraction');},
   syncVicidialComments:()=>{syncStarted=true;return new Promise((resolve,reject)=>{resolveSync=()=>fails===true?reject(Error('Native sync temporarily unavailable')):resolve();});},
   transferVicidialCall:async()=>{assert.equal(syncStarted,true);transfers++;call.transfer_status='SUBMITTED';if(fails!=='pending')resolveSync();},
  }};
  const callback=load('lib/vicidial-callback.ts',deps).vicidialCallback;
  const response=await Promise.race([callback(new Request('http://localhost/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':c.id},body:JSON.stringify({action:'retry-sync',eventId:crypto.randomUUID(),externalCallId:'Y0316001655000402028',callId:call.id})})),new Promise((_,reject)=>setTimeout(()=>reject(Error('Transfer response blocked by comment synchronization')),500))]);
  const body=await response.json();assert.equal(response.status,200);assert.equal(transfers,1);assert.equal(body.transferSubmitted,true);assert.equal(body.syncPending,fails!==false);if(fails==='pending')resolveSync();
 }
});

test('consented human transfer submits the real VICIdial command once despite pending lead sync and missing fields',async()=>{
 for(const acceptedOffer of [false,true]){
 let commands=0;
 const call={id:'call',status:'ANSWERED',handoff_ready:true,transfer_consent:true,transfer_status:'',vicidial_sync_status:'RETRY',conversation_busy:false,conversation_history:[U('Transfer me.')],script_snapshot:{script:'Ask age and state.',campaignSettings:{requiredLeadFields:['Age','State']}},live_config:{transferInGroup:'LICENSED',remoteUsers:['9001']},vicidial_call_id:'native-call',vicidial_lead_id:'234',vicidial_agent_user:'9001',bridge_secret_ciphertext:'bridge',secret_ciphertext:'dialer'};
 const query=async(sql)=>{
  if(sql.includes('SELECT a.*,c.live_config'))return {rows:[{...call}]};
  if(sql.includes("transfer_status='UNCERTAIN'")){call.transfer_status='UNCERTAIN';return {rows:[{id:call.id}],rowCount:1};}
  if(sql.includes("transfer_status='SUBMITTED'"))call.transfer_status='SUBMITTED';
  return {rows:[],rowCount:1};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const r=load('lib/vicidial-results.ts',{'./database':{db:async()=>pool},'./agent-test':{},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-config':{vicidialLiveConfig:{parse:v=>({...v})}},'./agent-runtime':{setRuntimeState:async()=>{}},'./vicidial-bridge':{requestBridge:async()=>({accepted:true})},'./vicidial':{
  requireVicidialSuccess:v=>{assert.match(v,/SUCCESS:/);},
  vicidialRequest:async(_url,_user,_key,p)=>{if(p.function==='agent_status')return 'status|callerid|lead_id\nINCALL|native-call|234';if(p.function==='in_group_status')return 'ingroups|agents_waiting\nLICENSED|1';commands++;assert.equal(p.function,'ra_call_control');assert.equal(p.stage,'INGROUPTRANSFER');assert.equal(p.ingroup_choices,'LICENSED');return 'SUCCESS: ra_call_control';},
 }});
 if(acceptedOffer)call.conversation_history=[A('May I connect you with a licensed specialist?'),U('Okay.')];
 call.qualification={mode:acceptedOffer?'CUSTOMER_ACCEPTED_HANDOFF':'CUSTOMER_REQUESTED_HUMAN',scriptHash:r.qualificationHash(call.script_snapshot),historyHash:r.conversationHash(call.conversation_history)};
 assert.deepEqual(await r.transferVicidialCall(call.id),{submitted:true});assert.equal(commands,1);
 await assert.rejects(r.transferVicidialCall(call.id),/already submitted/);assert.equal(commands,1);
 }
});
test('a fact followed by an immediate transfer request retains the fact without treating the request as its value',()=>{
 const r=results(),history=[A('What is your age?'),U('I am 67. Please transfer me.')];
 assert.deepEqual(r.partialHandoffFields(history),{age:{value:'I am 67',evidence:'I am 67. Please transfer me.'}});
});

test('human comments include mapped fields and clear follow-up instructions without fabricated answers',()=>{
 const r=results();
 const call={collected_fields:{name:{value:'Alex Smith'},age:{value:'67'}},transfer_consent:true,qualification:{mode:'CUSTOMER_REQUESTED_HUMAN',handoffNotes:[{kind:'need',evidence:'Transfer me.'},{kind:'preference',evidence:'Please call after lunch.'}]}};
 const summary=r.humanHandoffSummary(call);
 assert.match(summary,/name: Alex Smith/);assert.match(summary,/age: 67/);
 assert.match(summary,/complete remaining script details/);assert.match(summary,/uncollected: unknown/);assert.match(summary,/Please call after lunch/);
 assert.doesNotMatch(summary,/need: Transfer me/);
 assert.match(r.humanHandoffSummary({...call,collected_fields:{}}),/No lead answers collected/);
 const full=r.humanHandoffSummary({collected_fields:call.collected_fields,transfer_consent:true,qualification:{handoffNotes:[]}});
 assert.match(full,/name: Alex Smith/);assert.doesNotMatch(full,/remaining script details/);
});

test('audio confirmation and permission are never collected as lead answers',()=>{
 const r=results();
 const h=[A('Hello, this is Alex. How are you today?'),U('Fine'),A('Is now a good time for a brief call?'),U('Yes'),A('What is your age?'),U('Hello?'),A('Can you hear me clearly?'),U('Yes'),A('What is your age?'),U('67'),U('Transfer me.')];
 assert.deepEqual(r.partialHandoffFields(h),{age:{value:'67',evidence:'67'}});
 assert.deepEqual(r.partialHandoffFields([A('What is your age?'),U('Hello?'),A('Can you hear me clearly?'),U('Yes'),U('Transfer me.')]),{});
});

test('native update_lead writes mapped details and partial-handoff instructions into the human comment box',async()=>{
 const call={id:'call',voip_connection_id:'connection',collected_fields:{name:{value:'Alex Smith'},age:{value:'67'}},outcome:'INCOMPLETE',transfer_consent:true,handoff_ready:true,qualification:{mode:'CUSTOMER_REQUESTED_HUMAN',handoffNotes:[]},script_snapshot:{campaignSettings:{commentLimit:1000}},secret_ciphertext:'key',vicidial_lead_id:'234'};
 let native={comments:'Existing operator note',first_name:'',last_name:''},writes=0;
 const query=async sql=>sql.startsWith('SELECT a.*')?{rows:[call]}:sql.startsWith("UPDATE vicidial_sync_jobs SET state='RUNNING'")?{rows:[{id:'job'}]}:{rows:[],rowCount:1};
 const r=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-config':{},'./vicidial':{
  requireVicidialSuccess:response=>assert.match(response,/SUCCESS:/),
  vicidialRequest:async(_s,_u,_k,p)=>{
   if(p.function==='lead_all_info')return `lead_id|comments|first_name|last_name\n234|${native.comments}|${native.first_name}|${native.last_name}`;
   assert.equal(p.function,'update_lead');assert.equal(p.lead_id,'234');writes++;native={...native,...p};return 'SUCCESS: update_lead updated';
  },
 }});
 await r.syncVicidialComments('call');assert.equal(writes,1);assert.equal(native.first_name,'Alex');assert.equal(native.last_name,'Smith');
 for(const text of ['Existing operator note','name: Alex Smith','age: 67','complete remaining script details','uncollected: unknown'])assert.ok(native.comments.includes(text),text);
});

test('handoff explanation questions never become human requests or transfer consent at any layer',()=>{
 const r=results();
 const offer=A('Let me connect you with a licensed specialist who can look up your exact plan.');
 const questions=['Why do you wanna connect me with a licensed agent?','Why do you want to connect me with the license agent?','Why are you transferring me?','How will you connect me to the agent?','What happens if you connect me with someone?','Do you want to speak to a licensed agent?','I asked why you want to connect me with a specialist.','Why should I want to talk to a human?'];
 for(const text of questions){
  assert.equal(intent.customerRequestsHuman(text),false,text);
  assert.equal(r.hasTransferConsent([offer,U(text)]),false,text);
  assert.equal(r.hasRequestedHumanHandoff([offer,U(text)]),false,text);
  assert.equal(r.hasTransferConsent([offer,U(text),U('Yes.')]),false,'An unanswered question consumed the old offer: '+text);
 }
});
test('the failed recording cannot prepare a customer-requested transfer or write false consent',async()=>{
 let writes=0;const r=results(async()=>{writes++;return {rowCount:1}});
 const h=[A('Let me connect you with a licensed specialist.'),U('Why do you wanna connect me with a licensed agent?'),A('Alright, please wait.'),U('Wait for what?')];
 await assert.rejects(r.prepareRequestedHumanHandoff('call',h,{}),/No current customer consent/);assert.equal(writes,0);
 assert.equal(intent.handoffWaiting(h),false);
});
test('real transfer commands and polite first-person requests retain consent, while presence does not grant it',()=>{
 const r=results();
 for(const text of ['Please connect me with a licensed specialist.','Can you please connect me with an agent?','I would like to talk to a human.',"I'd like to speak to an agent.",'Why is this necessary? Please connect me to the specialist.']){
  assert.equal(intent.customerRequestsHuman(text),true,text);assert.equal(r.hasRequestedHumanHandoff([U(text)]),true,text);
 }
 for(const text of ["I'm here.",'I am waiting.','Yes, I can hear you.','Yeah, you can.','Hello?'])assert.equal(r.hasTransferConsent([A('Would you like me to connect you?'),U(text)]),false,text);
 const h=[A('Would you like me to connect you?'),U('Yes.'),A('Alright, please wait.')];assert.equal(intent.handoffWaiting(h),true);
});
test('handoff explanation answers why and invites an explicit choice without claiming action success',()=>{
 const script='Let me connect you with a licensed specialist who can look up your exact plan that fits you.';
 const h=[A(script)];
 const reply=intent.handoffExplanationReply('Why do you wanna connect me with a licensed agent?',h,script);
 assert.match(reply,/specialist can look up your exact plan/);assert.match(reply,/Would you like me to connect you\?/);assert.doesNotMatch(reply,/please wait|refund owed|have connected/);
 assert.match(intent.handoffExplanationReply('Wait for what?',[...h,A('Alright, please wait.')],script),/should have explained/);
 assert.equal(intent.handoffExplanationReply('Please connect me.',h,script),undefined);
 assert.equal(intent.transferConsent([...h,U('Why connect me?'),A(reply),U('Yes.')]),true);
});

test('a specialist definition uses the assigned role rather than invented sales or refund claims',()=>{
 const reply=intent.handoffExplanationReply('What is a licensed specialist?',[],'Let me connect you with a licensed specialist who can review your plan.');
 assert.match(reply,/professional license/);assert.match(reply,/role here is to review your plan/);assert.doesNotMatch(reply,/don.t sell|certified|refund|eligible/);
});


test('a drained AudioSocket announcement submits one native transfer and suppresses recovery on concurrent calls', async () => {
 const net=require('node:net'),os=require('node:os');
 const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-drain-'));
 const announcement='Let me connect you with a licensed specialist.';
 const sockets=[], states=new Map(), requests=[];
 const connection={id:crypto.randomUUID(),enabled:true,bridge_secret_ciphertext:'bridge',secret_ciphertext:'dialer',live_config:{enabled:true}};
 let callback;
 const bridge=createBridge({
  siteUrl:'https://fixture.invalid/',connectionId:connection.id,secret:'handoff-fixture-'.repeat(4),spoolDir:dir,
  testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},
  fetchImpl:async (_,init)=>{
   const event=JSON.parse(init.body);
   if(event.action==='connected'){
    const state=[...states.values()].find(item=>!item.admitted);
    state.admitted=true;state.call.vicidial_call_id=event.externalCallId;
    return Response.json({callId:state.call.id,first:'ai',mediaReady:true});
   }
   const state=states.get(event.callId);
   if(event.action==='turn'){
    assert.equal(event.silenceStep,undefined);
    state.turns++;
    assert.equal(state.turns,1);
    state.call.conversation_history.push({...A(announcement),handoffTurnId:event.eventId});
    const pcm=Buffer.alloc(24000,12).toString('base64');
    return new Response([{type:'handoff-announcement',turnId:event.eventId},{type:'delta',text:announcement},{type:'pcm',sampleRate:24000,data:pcm},{type:'done',turnId:event.eventId}].map(JSON.stringify).join('\n')+'\n');
   }
   if(event.action==='playback-complete'){
    const result=await callback(new Request('http://localhost/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connection.id},body:JSON.stringify(event)}));
    state.ack=event;
    return result;
   }
   return Response.json({saved:true});
  }
 });
 try{
  const calls=new Map();
  const query=async(sql,args=[])=>{
   if(sql.startsWith('SELECT * FROM voip_connections'))return {rows:[connection]};
   if(sql.startsWith('SELECT * FROM agent_calls WHERE voip_connection_id'))return {rows:[...calls.values()].filter(call=>call.vicidial_call_id===args[1])};
   const call=calls.get(args[0]);
   if(sql.includes('SELECT a.*,c.live_config'))return {rows:[{...call}]};
   if(sql.startsWith('SELECT transfer_status'))return {rows:[{transfer_status:call.transfer_status}]};
   if(sql.includes('RETURNING conversation_history')){call.conversation_history=JSON.parse(args[1]);return {rowCount:1,rows:[{conversation_history:call.conversation_history}]};}
   const state=sql.match(/UPDATE agent_calls SET transfer_status='([A-Z]+)'/)?.[1];
   if(state&&call)call.transfer_status=state;
   return {rowCount:1,rows:[]};
  };
  const pool={query,connect:async()=>({query,release(){}})};
  const deps={'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:v=>v},'./agent-test':{},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-queue':{},'./vicidial-recording':{},'./bpo-entitlements':{},'./vicidial-handoff':{},
   './vicidial-config':{vicidialLiveConfig:{parse:v=>({...v})}},'./agent-runtime':{setRuntimeState:async()=>{}},
   './vicidial-bridge':{verifyBridgeSignature:()=>true,requestBridge:async()=>({accepted:true})},
   './vicidial':{requireVicidialSuccess:value=>assert.match(value,/SUCCESS:/),vicidialRequest:async(_url,_user,_key,p)=>{
    const state=[...states.values()].find(item=>item.call.vicidial_agent_user===p.agent_user);
    if(p.function==='agent_status')return 'status|callerid|lead_id\nINCALL|'+state.call.vicidial_call_id+'|234';
    assert.equal(p.stage,'INGROUPTRANSFER');
    assert.ok(state.pcmBytes>=8000,'native request must follow the complete announcement PCM');
    requests.push(state.call.id);
    return state.fail ? 'ERROR: simulated rejection' : 'SUCCESS: ra_call_control';
   }}
  };
  const results=load('lib/vicidial-results.ts',deps);
  callback=load('lib/vicidial-callback.ts',{...deps,'./vicidial-results':{...results,
   syncVicidialComments:async()=>{},
   collectVicidialResult:async(id,history)=>{
    const call=calls.get(id);
    const question='What is your age?';
    call.transfer_consent=results.hasTransferConsent(history);call.handoff_ready=true;
    call.qualification={scriptHash:results.qualificationHash(call.script_snapshot),historyHash:results.conversationHash(history),
     steps:[{id:'age',kind:'customer_answer',conditional:false,requirement:question}],
     stepChecks:[{id:'age',status:'complete',agentEvidence:[question],customerEvidence:['67']}]};
    return {handoffReady:true};
   }
  }}).vicidialCallback;
  await new Promise((resolve,reject)=>bridge.audio.once('error',reject).listen(0,'127.0.0.1',resolve));
  for(let i=0;i<3;i++){
   const call={id:crypto.randomUUID(),status:'ANSWERED',handoff_ready:false,transfer_consent:false,transfer_status:'',vicidial_sync_status:'SYNCED',conversation_busy:false,
    conversation_history:[A('What is your age?'),U('67')],script_snapshot:{script:'What is your age?\n'+announcement,campaignSettings:{requiredLeadFields:['What is your age?']}},
    live_config:{transferInGroup:'LICENSED',remoteUsers:['9001','9002']},vicidial_lead_id:'234',vicidial_agent_user:String(9001+i),bridge_secret_ciphertext:'bridge',secret_ciphertext:'dialer'};
   const state={call,turns:0,pcmBytes:0,fail:i===2};states.set(call.id,state);calls.set(call.id,call);
   const socket=net.connect(bridge.audio.address().port,'127.0.0.1');sockets.push(socket);
   let buffer=Buffer.alloc(0);
   socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=3&&buffer.length>=3+buffer.readUInt16BE(1)){
     const size=buffer.readUInt16BE(1);if(buffer[0]===0x10)state.pcmBytes+=size;
     buffer=buffer.subarray(3+size);
    }
   });
   await new Promise((resolve,reject)=>socket.once('connect',resolve).once('error',reject));
   socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));
 }
 const deadline=Date.now()+6000;
 while((requests.length<3||[...states.values()].some(state=>!state.ack))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual(new Set(requests),new Set(states.keys()));
 for(const state of states.values()){
  const duplicate={...state.ack,eventId:crypto.randomUUID()};
  const replay=await callback(new Request('http://localhost/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connection.id},body:JSON.stringify(duplicate)}));
  assert.equal((await replay.json())[state.fail ? "transferFailed" : "transferSubmitted"],true);
  assert.equal(state.turns,1);
 }
 assert.equal(requests.length,3);
 await new Promise(resolve=>setTimeout(resolve,4200));
 assert.equal(requests.length,3);
 assert.ok([...states.values()].every(state=>state.turns===1));
 } finally {
  sockets.forEach(socket=>socket.destroy());bridge.close();
  await new Promise(resolve=>setTimeout(resolve,100));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('native session announces immediately after the real last answer and preserves explicit consent', async () => {
 const {createTesterService}=require('../gateway/tester-service.cjs');
 const secret='handoff-worker-fixture-'.repeat(4);
 const service=createTesterService({secret,testHooks:true,maxSessions:5});
 const original=global.fetch;
 const announcement='Let me connect you with a licensed specialist.';
 const question='What is your age?';
 const ids=[];
 global.fetch=async()=>new Response(new Uint8Array(4800).fill(12),{headers:{
  'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'
 }});
 async function start(extra='',afterQuestion=''){
  const owner='vici-'+crypto.randomUUID();
  const call=(action,id,body)=>service.dispatch(new Request('http://fixture/tester/'+action,{
   method:'POST',headers:{'x-shahvex-owner':owner,'x-shahvex-ai-key':secret,'x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)
  }));
  const script="Hi, this is Lauren from Wellness Team. I am calling to review your account.\n"+extra+question+'\n'+afterQuestion+announcement;
  const {id}=await (await call('start',null,{agentId:crypto.randomUUID(),requirePlaybackAck:true,config:{
   name:'Lauren',voice:'fixture',first:'ai',script,goal:'Review your account',task:'',instructions:'',knowledge:'',style:'Friendly'
  }})).json();
  assert.ok(id);ids.push(()=>call('stop',id,{}));
  const session=service.sessionStore.get(id);
  session.purposeDelivered=true;session.purposeAcknowledged=true;
  if(extra)session.messages.push(A('May I connect you with a licensed specialist?'),U('Mm-hmm.'));
  session.messages.push(A(question));
  session.questionLedger=new Map([[require('../gateway/reply-integrity.cjs').questionKey(question),{status:'delivered'}]]);
  return async(action,body)=>call(action,id,body);
 }
 try{
  for(const permission of ['', 'May I connect you with a licensed specialist?\n']){
   const call=await start(permission);
   const response=await call('turn',{text:'67'});
   const events=(await response.text()).trim().split('\n').map(JSON.parse);
   assert.equal(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),announcement);
   assert.equal(events.filter(e=>e.type==='handoff-announcement').length,1);
   assert.ok(events.some(e=>e.type==='pcm'));
   for(const text of [{silenceStep:3},{text:'Hello'},{text:'Yep'}]){
    assert.equal((await call('turn',text)).status,409);
   }
  }
  const refusal=await start('','If refuses: What is your ZIP code?\n');
  const declined=(await (await refusal('turn',{text:"I'd rather not answer."})).text()).trim().split('\n').map(JSON.parse);
  assert.equal(declined.filter(e=>e.type==='delta').map(e=>e.text).join(''),'What is your ZIP code?');
  assert.ok(!declined.some(e=>e.type==='handoff-announcement'));
 }finally{await Promise.all(ids.map(stop=>stop()));global.fetch=original;}
});
