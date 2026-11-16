const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:require(n),m,m.exports);return m.exports;}
const config=load('lib/campaign-config.ts'),comments=load('lib/vicidial-comment-merge.ts');
test('campaign configuration accepts custom categories/scripts and rejects fake TTS controls',()=>{
 const c=config.campaignSettings.parse({goal:'Custom goal',requiredLeadFields:['Name'],companyName:'Configured business'});
 assert.match(config.campaignInstructionText(c),/Configured business/);assert.match(config.campaignInstructionText(c),/Name/);
 assert.equal(config.campaignSettings.safeParse({speed:1.5}).success,false);assert.equal(config.campaignSettings.safeParse({pitch:3}).success,false);
 assert.deepEqual(config.parseVicidialTable('campaign_id|campaign_name|active\nCUSTOM01|Custom campaign|Y'),[{campaign_id:'CUSTOM01',campaign_name:'Custom campaign',active:'Y'}]);
 assert.throws(()=>config.parseVicidialTable('ERROR: auth forbidden'));assert.throws(()=>config.parseVicidialTable('<html>Login</html>'));
});
test('comment merge preserves operator notes, is idempotent, and refuses overflow',()=>{
 const id='11111111-1111-4111-8111-111111111111',original='Operator: callback tomorrow.';
 const first=comments.mergeCallComments(original,'Name: Ada; Age: 65',id);assert.ok(first.startsWith(original));
 assert.equal(comments.mergeCallComments(first,'Name: Ada; Age: 65',id),first);
 const edited=comments.mergeCallComments(first+' Human: confirmed.','Name: Ada Lovelace',id);assert.ok(edited.endsWith(' Human: confirmed.'));assert.ok(!edited.includes('Age: 65'));
 const compact=comments.mergeCallComments(original,'x'.repeat(400),id);assert.match(compact,/Details on website/);assert.ok(compact.startsWith(original));
 assert.throws(()=>comments.mergeCallComments('x'.repeat(240),'Name: Ada',id),/comments full/);
 assert.throws(()=>comments.mergeCallComments(`[SV:${id}]broken`,'Name: Ada',id),/Incomplete/);
});
test('concurrent calls cannot reserve one READY AI instance twice',async()=>{
 const state={state:'READY',call_id:null};
 const query=async(sql,p)=>{assert.match(sql,/state='READY' AND call_id IS NULL/);if(state.state!=='READY'||state.call_id)return {rows:[],rowCount:0};Object.assign(state,{state:'RESERVED',call_id:p[1]});return {rows:[{agent_id:p[0]}],rowCount:1};};
 const runtime=load('lib/agent-runtime.ts',{'./database':{}});
 const results=await Promise.all(Array.from({length:50},(_,i)=>runtime.reserveAgent({query},'agent',`call-${i}`,'campaign-A')));
 assert.equal(results.filter(Boolean).length,1);assert.equal(state.state,'RESERVED');
});
test('release requires independent AI-leg cleanup and customer-end or human-answer evidence in either order',async()=>{
 let completed=0,released=0;const call={id:'call',ai_leg_released:false,customer_ended:false,transfer_status:'SUBMITTED'};
 const query=async sql=>{if(sql.startsWith('SELECT *'))return {rows:[call]};if(sql.includes("SET status=CASE"))completed++;if(sql.includes('UPDATE ai_agent_runtime_states r'))released++;return {rows:[]};};
 const runtime=load('lib/agent-runtime.ts',{'./database':{db:async()=>({connect:async()=>({query,release(){}})})}});
 assert.equal(await runtime.releaseConfirmedAgent('call'),false);call.transfer_status='ANSWERED';assert.equal(await runtime.releaseConfirmedAgent('call'),false);
 call.ai_leg_released=true;assert.equal(await runtime.releaseConfirmedAgent('call'),true);assert.equal(released,1);
 call.transfer_status='SUBMITTED';assert.equal(await runtime.releaseConfirmedAgent('call'),false);
 call.customer_ended=true;assert.equal(await runtime.releaseConfirmedAgent('call'),true);assert.equal(completed,2);
});
test('expired lease alone never releases customer media and invalid Native state remains unavailable',async()=>{
 const updates=[],calls=[];const q={agent_id:'agent',remote_user:'9001',ready:true,runtime_state:'BUSY',call_id:'call',connection_enabled:true,last_heartbeat_at:new Date(),line_state:'ACTIVE'};
 const query=async(sql,p)=>{updates.push(sql);if(sql.includes('SELECT x.agent_id'))return {rows:[]};if(sql.includes('SELECT q.*'))return {rows:[q]};return {rows:[]};};
 const queues=load('lib/vicidial-queue.ts',{'./database':{db:async()=>({query})},'./bpo-entitlements':{},'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{vicidialRequest:async(_a,_b,_c,p)=>{calls.push(p);return 'SUCCESS: update_remote_agent changed';},requireVicidialSuccess:v=>v}});
 const r=await queues.reconcileVicidialQueues('connection');assert.equal(r.confirmed,1);assert.equal(calls[0].status,'INACTIVE');assert.equal(calls[0].function,'update_remote_agent');
 assert.ok(updates.some(s=>s.includes("SET state='ERROR'")));assert.ok(!updates.some(s=>s.includes('call_id=NULL')));
});
test('campaign assignment checks owner and writes exact Native campaign without touching number lists',async()=>{
 const writes=[];const save=load('lib/agent-campaign-assignment.ts').saveAgentCampaign;
 const tx={query:async(sql,p)=>{writes.push({sql,p});if(sql.startsWith('SELECT'))return {rows:p[1]==='owner'?[{id:'definition',connection_id:'connection',external_campaign_id:'EXACT01'}]:[]};return {rows:[]};}};
 await assert.rejects(save(tx,'agent','foreign','definition'),/owned campaign/);assert.equal(writes.length,3);writes.length=0;
 await save(tx,'agent','owner','definition');assert.equal(writes.length,5);assert.ok(writes[4].p.includes('EXACT01'));assert.ok(!writes.some(w=>/lead_rows|add_lead|originate/.test(w.sql)));
});
test('durable lead sync merges Native operator notes, verifies readback and bounds retries',async()=>{
 let job,fail=false,writes=0;const a={id:'call',voip_connection_id:'connection',vicidial_lead_id:'42',collected_fields:{Name:{value:'Ada'}},outcome:'GOAL_ACHIEVED',script_snapshot:{campaignSettings:{}},vicidial_sync_status:'PENDING'};
 let native='Operator existing note';
 const query=async(sql,p=[])=>{
  if(sql.startsWith('SELECT a.*'))return {rows:[a]};
  if(sql.startsWith('SELECT state FROM vicidial_sync_jobs'))return {rows:job?[{state:job.state}]:[]};
  if(sql.startsWith('INSERT INTO vicidial_sync_jobs')){job ||= {id:p[0],attempts:0,max_attempts:5,state:'PENDING'};return {rows:[]};}
  if(sql.includes("SET state='RUNNING'")){if(job.attempts>=5||job.state==='SUCCEEDED')return {rows:[]};job.attempts++;return {rows:[{...job}]};}
  if(sql.includes("SET state='SUCCEEDED'"))job.state='SUCCEEDED';
  if(sql.includes("SET state=CASE"))job.state=job.attempts>=5?'FAILED':'RETRY';
  if(sql.includes("SET vicidial_sync_status='SYNCED'"))a.vicidial_sync_status='SYNCED';
  return {rows:[]};
 };
 const results=load('lib/vicidial-results.ts',{'./database':{db:async()=>({query})},'./agent-test':{},'./agent-runtime':{},'./campaign-config':config,'./vicidial-comment-merge':comments,'./vicidial-bridge':{},'./vicidial-config':{},'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{requireVicidialSuccess:v=>v,vicidialRequest:async(_a,_b,_c,p)=>{if(p.function==='lead_all_info')return `lead_id|comments\n42|${native}`;writes++;if(fail)throw Error('timeout');native=p.comments;return 'SUCCESS: update_lead changed';}}});
 await results.syncVicidialComments('call');assert.equal(a.vicidial_sync_status,'SYNCED');assert.ok(native.startsWith('Operator existing note'));assert.match(native,/Name: Ada/);assert.equal(writes,1);
 a.vicidial_sync_status='PENDING';await results.syncVicidialComments('call');assert.equal(writes,1);assert.equal(a.vicidial_sync_status,'SYNCED');
 job=undefined;a.vicidial_sync_status='PENDING';fail=true;
 for(let i=0;i<5;i++)await assert.rejects(results.syncVicidialComments('call'),/Transfer blocked/);
 assert.equal(job.state,'FAILED');const attempted=writes;
 await assert.rejects(results.syncVicidialComments('call'),/retry limit/);assert.equal(writes,attempted);
});
test('out-of-order signed events retry, completed events replay safely, and conflicting payloads fail closed',async()=>{
 const crypto=require('node:crypto'),connectionId=crypto.randomUUID(),callId=crypto.randomUUID(),eventId=crypto.randomUUID();
 let call,writes=0;const ledger=new Map();
 const query=async(sql,p=[])=>{
  const row=v=>({rows:v?[v]:[],rowCount:v?1:0});
  if(sql.startsWith('SELECT * FROM voip_connections'))return row({id:connectionId,bridge_secret_ciphertext:'secret',secret_ciphertext:'key',live_config:{enabled:true,remoteUsers:['9001'],transferInGroup:'HUMAN',bridgeUrl:'https://bridge.example.test',recordingBaseUrl:'https://bridge.example.test/'}});
  if(sql.startsWith('INSERT INTO vicidial_events')){if(ledger.has(p[1]))return row(null);ledger.set(p[1],{payload_hash:p[4],processing_state:'PENDING'});return row({event_id:p[1]});}
  if(sql.startsWith('SELECT payload_hash'))return row(ledger.get(p[1]));
  if(sql.startsWith('UPDATE vicidial_events')){
   if(sql.includes("processing_state='RUNNING'")){ledger.get(p[1]).processing_state='RUNNING';return row({event_id:p[1]});}
   if(sql.includes('processing_state=$1')){Object.assign(ledger.get(p[2]),{processing_state:p[0],response_payload:JSON.parse(p[3]),response_status:p[4]});return row(null);}
  }
  if(sql.startsWith('SELECT * FROM agent_calls'))return row(call);
  if(sql.startsWith('UPDATE agent_calls SET ai_recording_id')){writes++;return row(null);}
  throw Error('Unexpected event SQL '+sql);
 };
 const service=load('lib/vicidial-callback.ts',{'server-only':{},'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':{verifyBridgeSignature:()=>true},'./vicidial':{},'./vicidial-config':load('lib/vicidial-config.ts'),'./agent-test':{},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-results':{},'./vicidial-queue':{},'./vicidial-recording':{},'./agent-runtime':{},'./vicidial-handoff':{},'./bpo-entitlements':{}});
 const payload={action:'recording',eventId,externalCallId:'Y0316001655000402028',callId,aiRecordingId:crypto.randomUUID(),recordingSize:100};
 const send=value=>service.vicidialCallback(new Request('https://site.example.test/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connectionId},body:JSON.stringify(value)}));
 assert.equal((await send(payload)).status,404);assert.equal(ledger.get(eventId).processing_state,'FAILED');
 call={id:callId};assert.equal((await send(payload)).status,200);assert.equal(writes,1);
 assert.deepEqual(await (await send(payload)).json(),{saved:true});assert.equal(writes,1);
 assert.equal((await send({...payload,aiRecordingId:crypto.randomUUID()})).status,409);assert.equal(writes,1);
});
