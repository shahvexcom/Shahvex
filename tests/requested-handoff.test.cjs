const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),{createRequire}=require('node:module');
const intent=require('../gateway/handoff-intent.cjs');
function load(file,deps={}){const filename=path.resolve(file),req=createRequire(filename),m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='server-only'?{}:n.startsWith('./')&&fs.existsSync(path.resolve(path.dirname(filename),n+'.ts'))?load(path.resolve(path.dirname(filename),n+'.ts'),deps):req(n),m,m.exports);return m.exports;}
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
 for(const fails of [false,true,'pending']){
  let syncStarted=false,transfers=0,resolveSync;
  const call={id:crypto.randomUUID(),status:'ANSWERED',conversation_busy:false,conversation_history:[U('Transfer me.')],script_snapshot:{script:'Ask age then state.'},qualification:{},transfer_status:''};
  const c={id:crypto.randomUUID(),enabled:true,bridge_secret_ciphertext:'bridge-secret',secret_ciphertext:'dialer-secret',live_config:{enabled:true}};
  const query=async(sql)=>{if(sql.startsWith('SELECT * FROM voip_connections'))return {rows:[c]};if(sql.startsWith('INSERT INTO vicidial_events'))return {rowCount:1,rows:[{}]};if(sql.startsWith('SELECT transfer_status'))return {rows:[{transfer_status:call.transfer_status}]};if(sql.startsWith('SELECT * FROM agent_calls'))return {rows:[call]};return {rowCount:1,rows:[]};};
  const deps={'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':{verifyBridgeSignature:()=>true},'./vicidial':{},'./vicidial-config':{vicidialLiveConfig:{parse:v=>v}},'./agent-test':{},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-queue':{},'./vicidial-recording':{},'./agent-runtime':{},'./vicidial-handoff':{},'./bpo-entitlements':{},'./vicidial-results':{
   hasTransferConsent:()=>true,hasRequestedHumanHandoff:()=>true,conversationHash:()=>'',qualificationHash:()=>'',prepareRequestedHumanHandoff:async()=>({consent:true,handoffReady:true}),collectVicidialResult:async()=>{throw Error('Must not run qualification extraction');},
   syncVicidialComments:()=>{syncStarted=true;return new Promise((resolve,reject)=>{resolveSync=()=>fails===true?reject(Error('Native sync temporarily unavailable')):resolve();});},
   transferVicidialCall:async()=>{assert.equal(syncStarted,true);transfers++;call.transfer_status='SUBMITTED';if(fails!=='pending')resolveSync();},
  }};
  const callback=load('lib/vicidial-callback.ts',deps).vicidialCallback;
  const response=await Promise.race([callback(new Request('http://localhost/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':c.id},body:JSON.stringify({action:'retry-sync',eventId:crypto.randomUUID(),externalCallId:'Y0316001655000402028',callId:call.id})})),new Promise((_,reject)=>setTimeout(()=>reject(Error('Transfer response blocked by comment synchronization')),500))]);
  const body=await response.json();assert.equal(response.status,200);assert.equal(transfers,1);assert.equal(body.transferSubmitted,true);assert.equal(body.syncPending,fails!==false);if(fails==='pending')resolveSync();
 }
});

test('requested human transfer submits the real VICIdial command once despite pending lead sync and missing fields',async()=>{
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
 call.qualification={mode:'CUSTOMER_REQUESTED_HUMAN',scriptHash:r.qualificationHash(call.script_snapshot),historyHash:r.conversationHash(call.conversation_history)};
 assert.deepEqual(await r.transferVicidialCall(call.id),{submitted:true});assert.equal(commands,1);
 await assert.rejects(r.transferVicidialCall(call.id),/already submitted/);assert.equal(commands,1);
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
 await assert.rejects(r.prepareRequestedHumanHandoff('call',h,{}),/No current customer request/);assert.equal(writes,0);
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
