const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
function load(file,deps={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='./vicidial-admission-recovery'?{recoverPreviousCallForAdmission:async()=>false}:n==='./recording-reference'?load('lib/recording-reference.ts'):n==='./vicidial-turn-admission'?load('lib/vicidial-turn-admission.ts'):n==='./agent-script-details'?load('lib/agent-script-details.ts'):n==='./agent-runtime'?load('lib/agent-runtime.ts',deps):n==='./campaign-config'?load('lib/campaign-config.ts'):n==='./vicidial-comment-merge'?load('lib/vicidial-comment-merge.ts'):n==='./vicidial-bridge'?{requestBridge:async()=>({accepted:true})}:require(n),m,m.exports);return m.exports;}
const leads=load('lib/vicidial-leads.ts');
const config=load('lib/vicidial-config.ts');
const vici=load('lib/vicidial.ts',{'server-only':{}});
const signing=load('lib/vicidial-bridge.ts',{'server-only':{},'./vicidial':vici});
const bridge=require('../deployment/vicidial-bridge/server.cjs');
const liveConfig={enabled:true,listId:'101',phoneCode:'1',remoteUsers:['9001','9002'],transferInGroup:'HUMANS',bridgeUrl:'https://bridge.example.test',recordingBaseUrl:'https://recordings.example.test/',recordingEnabled:true};

test('canonical shared sheets deduplicate numbers and reject wrong-country international numbers',()=>{
  const first=leads.sheetLeads(['Customer Name','Phone Number'],[['Ada','+1 (555) 555-0123'],['Ada','15555550123'],['Other','+925551234567'],['Noise','bad']],'1');
  const second=leads.sheetLeads(['Phone Number','Customer Name'],[['5555550123','Ada']],'1');
  assert.equal(first.length,1);assert.deepEqual(first,second);assert.equal(leads.leadSheetHash(first),leads.leadSheetHash(second));
  assert.throws(()=>leads.sheetLeads(['Name'],[['Ada']],'1'),/Phone Number/);
  assert.equal(leads.addedLeadId('SUCCESS: add_lead LEAD HAS BEEN ADDED - 5555550123|101|234|-4|api','5555550123','101'),'234');
  assert.throws(()=>leads.addedLeadId('SUCCESS: add_lead LEAD HAS BEEN ADDED - 5555550123|999|234|-4|api','5555550123','101'));
});

test('live readiness requires separate audio setup; callback signatures bind method, path, body and time',()=>{
  assert.deepEqual(config.missingVicidialSetup(liveConfig,true),[]);
  assert.ok(config.missingVicidialSetup({},false).includes('Enable VICIdial live calling'));
  const secret='fixture-only-secret-of-at-least-32-characters',stamp=String(Date.now()),body=Buffer.from('{"action":"ended"}');
  const sig=signing.bridgeSignature(secret,stamp,'POST','/api/telephony/vicidial',body);
  assert.equal(signing.verifyBridgeSignature(secret,stamp,sig,'POST','/api/telephony/vicidial',body),true);
  assert.equal(signing.verifyBridgeSignature(secret,stamp,sig,'GET','/api/telephony/vicidial',body),false);
  assert.equal(signing.verifyBridgeSignature(secret,stamp,sig,'POST','/wrong',body),false);
  assert.equal(signing.verifyBridgeSignature(secret,stamp,sig,'POST','/api/telephony/vicidial',Buffer.from('{}')),false);
  assert.equal(signing.verifyBridgeSignature(secret,String(Date.now()-120000),sig,'POST','/api/telephony/vicidial',body),false);
});

function startHarness({campaignId='TEST',liveOverride={},uncertain=false,mapped=false,assignedScript='Ask the customer name.',initialScript='',details={goals:[],tasks:[],instructions:[],conversationFlow:[],restrictions:[],knowledge:[],faqs:[]}}={}){
  const synced=new Map(),agents=new Map(),remoteLeads=new Map();let inserts=0,activated=0,sequence=200,lock=Promise.resolve(),firstUnknown=uncertain;
  const c={id:'connection-a',owner_id:'owner-a',enabled:true,status:'CONNECTED',direction:'OUTBOUND',campaign_id:campaignId,live_config:{...liveConfig,listId:'',...liveOverride},media_verified_at:new Date(),secret_ciphertext:'dialer-key',bridge_secret_ciphertext:'bridge-key'};
  const query=async(sql,p=[])=>{
    const row=x=>({rows:x?[x]:[],rowCount:x?1:0});
    if(sql.startsWith('SELECT c.*'))return row(c);
    if(sql.startsWith('SELECT d.*'))return row(mapped?{id:'definition',enabled:true,intake_state:'RUNNING',validated_at:new Date(),connection_id:c.id,external_campaign_id:c.campaign_id,script:'Campaign script: ask name and age.',settings:{goal:'Live-only goal override',instructions:'Live-only instruction override',knowledge:'Live-only knowledge override'}}:null);
    if(sql.startsWith('UPDATE campaign_agent_assignments'))return row(null);
    if(sql.startsWith('UPDATE vicidial_pool_agents SET line_state')||sql.startsWith('INSERT INTO ai_agent_runtime_states'))return row({agent_id:p[0]});
    if(sql.includes('SELECT a.id,a.name'))return row({id:p[0],name:p[0],local_voice_id:'voice',speaks_first:'ai',conversation_style:'Friendly',daily_call_limit:25,lead_headers:[],lead_rows:[],script_text:assignedScript,bpo_id:null});
    if(sql.startsWith('SELECT initial_script FROM live_monitor_settings')){assert.equal(p[0],c.owner_id);return row(initialScript?{initial_script:initialScript}:null);}
    if(sql.startsWith('SELECT COUNT'))return row({today:0,active:0});
    if(sql.startsWith('SELECT is_enabled')||sql.startsWith('SELECT id FROM vicidial_pools'))return row(null);
    if(sql.startsWith('INSERT INTO vicidial_pools'))return row({id:'pool-a'});
    if(sql.startsWith('SELECT agent_id,remote_user'))return {rows:[...agents.values()]};
    if(sql.startsWith('SELECT 1 FROM do_not_call'))return row(null);
    if(sql.startsWith('INSERT INTO vicidial_lead_sync')){if(!synced.has(p[2]))synced.set(p[2],{pool_id:p[3],vendor_code:p[4],state:'PENDING'});return row(null);}
    if(sql.startsWith('SELECT * FROM vicidial_lead_sync'))return row(synced.get(p[2]));
    if(sql.includes("SET state='SUBMITTING'")){synced.get(p[2]).state='SUBMITTING';return row(null);}
    if(sql.includes("SET state='SYNCED'")){Object.assign(synced.get(p[3]),{external_lead_id:p[0],state:'SYNCED'});return row(null);}
    if(sql.startsWith('INSERT INTO vicidial_pool_agents')){agents.set(p[0],{agent_id:p[0],pool_id:p[1],remote_user:p[2],config:JSON.parse(p[3])});return row(null);}
    throw Error(`Unexpected fixture SQL: ${sql}`);
  };
  const pool={query,connect:async()=>{let unlock;return {query:async(sql,p)=>{if(sql.includes('pg_advisory_lock(')){const prior=lock;lock=new Promise(r=>{unlock=r;});await prior;return {rows:[]};}if(sql.includes('pg_advisory_unlock')){unlock();return {rows:[]};}return query(sql,p);},release(){}};}};
  const api=async(_url,_user,_secret,p)=>{
    assert.equal(p.function,'update_remote_agent','Campaign calling must not upload leads or require list operations');
    activated++;assert.equal(p.number_of_lines,'1');assert.equal(p.campaign_id,'TEST');
    if(firstUnknown){firstUnknown=false;throw Error('fixture remote activation response uncertain');}
    return 'SUCCESS: update_remote_agent USER HAS BEEN UPDATED - api|9001';
  };
  const service=load('lib/vicidial-live.ts',{'server-only':{},'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{vicidialRequest:api,requireVicidialSuccess:vici.requireVicidialSuccess},'./vicidial-config':config,'./vicidial-bridge':{requestBridge:async(_url,_key,_path,p)=>{if(_path==='/health')return {aiOnlyRecording:true,humanAnswerEvents:true,maxCalls:100};assert.equal(p.connectionId,c.id);return {accepted:true};}},'./vicidial-leads':leads,'./agent-script-extraction':{extractAgentScript:async()=>details},'./agent-test':{localVoices:async()=>({voices:[{id:'voice'}]}),warmSelectedVoice:async()=>{}},'./bpo-entitlements':{}});
  return {service,agents,synced,get inserts(){return inserts;},get activated(){return activated;}};
}
test('VICIdial uses the saved initial script only when no nonblank script is assigned',async()=>{
  const {defaultInitialScript}=load('lib/agent-script-details.ts');
  for(const assignedScript of ['', '   ']){
    const h=startHarness({assignedScript});
    await h.service.startVicidialAgent('agent-a');
    const config=h.agents.get('agent-a').config;
    assert.equal(config.script,defaultInitialScript);
    assert.ok(config.instructions.includes('Do not invent these details'));
    assert.equal(config.goal,'');
  }
  const custom=startHarness({assignedScript:'',initialScript:'Introduce yourself and ask about the customer request.'});
  await custom.service.startVicidialAgent('agent-a');
  assert.equal(custom.agents.get('agent-a').config.script,'Introduce yourself and ask about the customer request.');
  assert.equal(custom.agents.get('agent-a').config.instructions,'Introduce yourself and ask about the customer request.');
  const h=startHarness({assignedScript:'Ask the customer name.',initialScript:'Do not replace assigned scripts.'});
  await h.service.startVicidialAgent('agent-a');
  assert.equal(h.agents.get('agent-a').config.script,'Ask the customer name.');
});

test('campaign agents start without a website sheet or list ID and never upload numbers',async()=>{
  const h=startHarness();const results=await Promise.all([h.service.startVicidialAgent('agent-a'),h.service.startVicidialAgent('agent-b')]);
  assert.equal(h.inserts,0);assert.equal(h.activated,2);assert.ok(results.every(r=>r.queued));
  assert.equal(new Set([...h.agents.values()].map(a=>a.remote_user)).size,2);
  assert.equal(h.agents.get('agent-a').config.script,'Ask the customer name.');
  await h.service.startVicidialAgent('agent-a');assert.equal(h.inserts,0);
});
test('uncertain remote activation retains its line and retries without any number upload',async()=>{
  const h=startHarness({uncertain:true});await assert.rejects(h.service.startVicidialAgent('agent-a'),/uncertain/);
  const remote=h.agents.get('agent-a').remote_user;
  await h.service.startVicidialAgent('agent-a');assert.equal(h.inserts,0);assert.equal(h.activated,2);
  assert.equal(h.agents.get('agent-a').remote_user,remote);
});
test('VICIdial uses exactly the tester configuration and system instructions without live-only prompt overrides',async()=>{
  const details={goals:['Collect name and age.'],tasks:['Ask the next unanswered question.'],instructions:['Answer briefly.'],conversationFlow:['Wait for the customer.'],restrictions:['Do not invent facts.'],knowledge:['Configured company knowledge.'],faqs:['Configured FAQ answer.']};
  const h=startHarness({mapped:true,details});await h.service.startVicidialAgent('agent-a');
  const shared=load('lib/agent-test.ts',{'server-only':{}}),live=shared.testConfig.parse(h.agents.get('agent-a').config);
  const expected={name:'agent-a',voice:'voice',first:'ai',script:'Campaign script: ask name and age.',goal:'Collect name and age.',task:'Ask the next unanswered question.',instructions:'Answer briefly.\nWait for the customer.\nDo not invent facts.',knowledge:'Configured company knowledge.\nConfigured FAQ answer.',style:'Friendly'};
  assert.deepEqual(live,expected);
  const testerId=shared.newTest('tester-owner','agent-a',expected),liveId=shared.newTest('vici-owner','agent-a',live);
  try{assert.deepEqual(shared.sessions.get(liveId).messages,shared.sessions.get(testerId).messages);assert.ok(!shared.sessions.get(liveId).messages[0].content.includes('Live-only'));}
  finally{shared.sessions.delete(testerId);shared.sessions.delete(liveId);}
});

test('grounded lead fields reject invented values and transfer requires the actual pending consent',()=>{
  const results=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
  const history=[{role:'assistant',content:'What is your age?'},{role:'user',content:'I am 67.'}];
  assert.deepEqual(results.groundedCallFields({fields:[{name:'Age',value:'67',evidence:'I am 67.'},{name:'Name',value:'Bob',evidence:'I am 67.'},{name:'City',value:'Phoenix',evidence:'Phoenix'}]},history),{Age:{value:'67',evidence:'I am 67.'}});
  assert.equal(results.hasTransferConsent([...history,{role:'user',content:'Yes'}]),false);
  assert.equal(results.hasTransferConsent([{role:'assistant',content:'May I connect you to a representative?'},{role:'user',content:'Yes.'}]),true);
  assert.equal(results.hasTransferConsent([{role:'user',content:"Don't transfer me to anyone."}]),false);
  assert.equal(results.hasTransferConsent([{role:'user',content:'Connect me to a real agent.'}]),true);
  assert.equal(results.hasTransferConsent([{role:'user',content:'I do not have insurance, connect me to a human.'}]),true);
  assert.equal(results.hasTransferConsent([{role:'user',content:'I do not want to speak to a human.'}]),false);
  assert.equal(results.hasTransferConsent([{role:'assistant',content:'I can transfer you later. Are you over 65?'},{role:'user',content:'Yes.'}]),false);
  assert.equal(results.hasTransferConsent([{role:'assistant',content:'May I connect you to an agent? What is your age?'},{role:'user',content:'Yes.'}]),false);
  assert.equal(results.hasTransferConsent([{role:'assistant',content:'Let me connect you with a licensed specialist.'},{role:'user',content:'Okay, go ahead.'},{role:'assistant',content:'Please wait.'},{role:'user',content:'How long will it take?'}]),true);
  for(const reply of ['Absolutely.','Certainly.','Of course.']) {
    assert.equal(results.hasTransferConsent([{role:'assistant',content:'Let me connect you with a specialist.'},{role:'user',content:reply}]),true);
    assert.equal(results.hasTransferConsent([{role:'assistant',content:'Are you over 65?'},{role:'user',content:reply}]),false);
  }
  for(const reply of ['Connect me.','Transfer me.']) {
    assert.equal(results.hasRequestedHumanHandoff([{role:'user',content:reply}]),true);
    assert.equal(results.hasRequestedHumanHandoff([{role:'user',content:reply},{role:'user',content:"Don't transfer me."}]),false);
  }
  assert.ok(results.leadComments({Name:{value:'A'.repeat(400)}},'GOAL_ACHIEVED','call-id').length<=255);
});

test('AudioSocket bridge authenticates control, sends real PCM through the shared turn endpoint and paces playback',{timeout:7000},async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-vici-')),secret='fixture-bridge-secret-at-least-32-characters',connectionId=crypto.randomUUID(),events=[];
  const b=bridge.createBridge({siteUrl:'https://website.example.test/',connectionId,secret,spoolDir:folder,logger:()=>{},fetchImpl:async(url,init)=>{
    assert.equal(signing.verifyBridgeSignature(secret,init.headers['x-shahvex-timestamp'],init.headers['x-shahvex-signature'],'POST','/api/telephony/vicidial',init.body),true);
    const value=JSON.parse(init.body);events.push(value);
    if(value.action==='connected')return Response.json({callId:'11111111-1111-4111-8111-111111111111',first:'ai'});
    if(value.action==='listen'){
      const audio=Buffer.from(value.audio,'base64');
      assert.equal(audio.toString('ascii',0,4),'RIFF');
      assert.equal(audio.readUInt32LE(24),16000);
      return Response.json({text:'Hello, who is calling?',confidence:0.99});
    }
    if(value.action==='turn')return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(1920,12).toString('base64')})+'\n'+JSON.stringify({type:'done'})+'\n');
    return Response.json({saved:true});
  }});
  await Promise.all([new Promise(r=>b.control.listen(0,'127.0.0.1',r)),new Promise(r=>b.audio.listen(0,'127.0.0.1',r))]);
  const post=async(url,value,authorized=true)=>{const body=Buffer.from(JSON.stringify(value)),time=String(Date.now());return fetch(`http://127.0.0.1:${b.control.address().port}${url}`,{method:'POST',headers:{'x-shahvex-timestamp':time,'x-shahvex-signature':authorized?bridge.signature(secret,time,'POST',url,body):'0'.repeat(64)},body});};
  let socket;
  try{
    assert.equal((await post('/prepare',{connectionId,remoteUser:'9001'},false)).status,401);
    assert.equal((await post('/prepare',{connectionId,remoteUser:'9001'})).status,200);
    const uuid=crypto.randomUUID();assert.equal((await post('/register',{uuid,externalCallId:'Y0316001655000402028',agentUser:'9001'})).status,200);
    socket=net.connect(b.audio.address().port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));
    const received=[];socket.on('data',data=>received.push({at:Date.now(),data}));
    socket.write(bridge.packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));
    const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(3000,i);
    const deadline=Date.now()+4000;while(received.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
    assert.ok(events.some(e=>e.action==='turn'));assert.equal(received.length,2);assert.ok(received[1].at-received[0].at>=10);
    assert.equal(events.find(e=>e.action==='turn').opening,true, 'AI-first calls introduce themselves immediately');
    socket.write(Buffer.concat([...Array.from({length:12},()=>bridge.packet(0x10,voice)),...Array.from({length:38},()=>bridge.packet(0x10,Buffer.alloc(320)))]));
    const audioDeadline=Date.now()+2000;while(!events.some(e=>e.action==='turn'&&e.text==='Hello, who is calling?')&&Date.now()<audioDeadline)await new Promise(r=>setTimeout(r,10));
    assert.ok(events.some(e=>e.action==='turn'&&e.text==='Hello, who is calling?'));
    const prepare=await post('/command',{callId:'11111111-1111-4111-8111-111111111111',action:'handoff-prepare'});assert.equal(prepare.status,200);
    const aiFile=path.join(folder,'recordings',uuid+'.part'),before=fs.readFileSync(aiFile);
    socket.write(bridge.packet(0x10,Buffer.alloc(320,44)));await new Promise(r=>setTimeout(r,40));assert.deepEqual(fs.readFileSync(aiFile),before);
    const disconnected=new Promise(r=>socket.once('close',r));
    const handoff=await post('/handoff-event',{action:'human-answered',externalCallId:'Y0316001655000402028',humanUser:'human-1'});assert.equal(handoff.status,200);await disconnected;
    await new Promise(r=>setTimeout(r,30));await b.flushEvents();assert.ok(events.some(e=>e.action==='ended'));assert.equal(events.filter(e=>e.action==='turn').length,2,'Only opening and customer speech may start AI turns; human audio must not');
    const recording=events.find(e=>e.action==='recording');assert.ok(recording.aiRecordingId);const audio=fs.readFileSync(path.join(folder,'recordings',recording.aiRecordingId+'.wav'));assert.equal(audio.readUInt16LE(22),2);assert.equal(audio.readUInt32LE(24),8000);assert.ok(audio.length>44);
  }finally{socket?.destroy();b.close();assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith("shahvex-vici-"));fs.rmSync(folder,{recursive:true,force:true});}
});

test('answered callbacks verify the dialer lead, preserve the shared tester prompt, and reject busy or mismatched pools',async()=>{
  const connectionId=crypto.randomUUID(),secret='fixture-callback-secret-at-least-32-characters';
  const shared=load('lib/agent-test.ts',{'server-only':{}});let call,wrong=false,busy=false,started=0,fallback=false,externalId='Y0316001655000402028';
  const query=async(sql,p=[])=>{const row=x=>({rows:x?[x]:[],rowCount:x?1:0});
    if(sql.startsWith('SELECT * FROM voip_connections'))return row({id:connectionId,enabled:true,live_config:liveConfig,bridge_secret_ciphertext:secret,secret_ciphertext:'key',username:'api',server_url:'https://dialer.example.test'});
    if(sql.startsWith('INSERT INTO vicidial_events')||sql.startsWith('UPDATE vicidial_events'))return row({event_id:'event'});
    if(sql.startsWith("UPDATE ai_agent_runtime_states SET state='RESERVED'"))return row({agent_id:p[0]});
    if(sql.startsWith('UPDATE agent_calls SET campaign_definition_id'))return row(call);
    if(sql.startsWith('SELECT * FROM agent_calls WHERE voip_connection'))return row(call);
    if(sql.startsWith('SELECT p.id pool_id')){assert.equal(p[1],'TEST');assert.equal(p[2],'9001');return row({pool_id:'pool-a',campaign_id:wrong?'OTHER':'TEST'});}
    if(sql.startsWith('SELECT id,script_snapshot FROM agent_calls'))return row(null);
    if(sql.includes('SELECT q.*,a.daily_call_limit')){assert.match(sql,/q.pool_id=\$1/);assert.match(sql,/last_assigned_at NULLS FIRST/);assert.match(sql,/SKIP LOCKED/);assert.match(sql,/NOT EXISTS.*agent_calls/s);assert.doesNotMatch(sql.split('ORDER BY')[0],/q\.remote_user=\$2/);return row(busy?null:{agent_id:p[3]?.includes('agent-a')?'agent-b':'agent-a',config:{name:'Assigned Agent',voice:'voice',first:'ai',goal:'Collect name',task:'Ask name',instructions:'',script:'Ask their name.',knowledge:'',style:'Friendly'},dialing_source:'DIRECT',max_call_duration_seconds:60});}
    if(sql.startsWith('SELECT id FROM agent_calls WHERE agent_id'))return row(fallback&&p[0]==='agent-a'?{id:'already-live'}:null);
    if(sql.startsWith('INSERT INTO lead_claims'))return row({lead_number:p[0]});
    if(sql.startsWith('INSERT INTO agent_calls')){call={id:p[0],agent_id:p[1],status:'ANSWERED',script_snapshot:JSON.parse(p[7]),conversation_history:[]};return row(call);}
    if(sql.startsWith('UPDATE agent_calls SET voice_session_id')){call.voice_session_id=p[0];return row(call);}
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory')||sql.startsWith('UPDATE lead_claims'))return row(null);
    throw Error('Unexpected callback fixture SQL: '+sql);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  const callback=load('lib/vicidial-callback.ts',{'server-only':{},'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':signing,'./vicidial':{vicidialRequest:async(_url,_user,_key,p)=>p.function==='agent_status'?`status|call_id|lead_id|campaign_id|phone_number\nINCALL|${externalId}|234|TEST|5555550123`:'lead_id|phone_code|phone_number\n234|1|5555550123'},'./vicidial-config':config,'./agent-test':{...shared,newTest:(...args)=>{started++;return shared.newTest(...args);}},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-results':{},'./bpo-entitlements':{},'./vicidial-recording':{},'./vicidial-queue':{queueAgentAllowed:async()=>true},'./vicidial-handoff':{}}).vicidialCallback;
  const post=async()=>{const body=Buffer.from(JSON.stringify({action:'connected',eventId:crypto.randomUUID(),externalCallId:externalId,agentUser:'9001'})),stamp=String(Date.now());return callback(new Request('https://website.example.test/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connectionId,'x-shahvex-timestamp':stamp,'x-shahvex-signature':signing.bridgeSignature(secret,stamp,'POST','/api/telephony/vicidial',body)},body}));};
  wrong=true;assert.equal((await post()).status,409);assert.equal(started,0);
  wrong=false;busy=true;assert.equal((await post()).status,409);assert.equal(started,0);
  busy=false;assert.equal((await post()).status,200);assert.equal(started,1);
  const session=shared.sessions.get(call.voice_session_id);assert.equal(session.owner,`vici-${call.id}`);assert.equal(session.config.script,'Ask their name.');
  for(const rule of [shared.conversationEtiquette,shared.customerResponseRules])assert.ok(session.messages[0].content.includes(rule));
  assert.equal((await post()).status,200);assert.equal(started,1);shared.sessions.delete(call.voice_session_id);
  call=null;fallback=true;externalId='Y0316001655000402029';assert.equal((await post()).status,200);assert.equal(call.agent_id,'agent-b');assert.equal(started,2);shared.sessions.delete(call.voice_session_id);
});

test('human transfer checks readiness and never repeats an uncertain provider command',async()=>{
  let waiting=0,commands=0,uncertain=false;
  const a={id:'call',status:'ANSWERED',handoff_ready:true,vicidial_sync_status:'SYNCED',transfer_consent:true,transfer_status:'',bridge_secret_ciphertext:'bridge-secret',live_config:liveConfig,secret_ciphertext:'secret',vicidial_call_id:'Y0316001655000402028',vicidial_agent_user:'9001',vicidial_lead_id:'234'};
  const query=async(sql)=>{if(sql.includes('SELECT a.*,c.live_config'))return {rows:[{...a}]};if(sql.includes("UPDATE agent_calls SET transfer_status='UNCERTAIN'")){a.transfer_status='UNCERTAIN';return {rows:[{id:'call'}],rowCount:1};}if(sql.includes("transfer_status='SUBMITTED'"))a.transfer_status='SUBMITTED';return {rows:[]};};
  const pool={query,connect:async()=>({query,release(){}})};
  const results=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-config':config,'./vicidial':{requireVicidialSuccess:vici.requireVicidialSuccess,vicidialRequest:async(_url,_user,_secret,p,agentApi)=>{if(p.function==='agent_status')return 'status|callerid|lead_id\nINCALL|Y0316001655000402028|234';if(p.function==='in_group_status')return `ingroups|agents_waiting\nHUMANS|${waiting}`;commands++;assert.equal(agentApi,true);assert.equal(p.stage,'INGROUPTRANSFER');assert.equal(p.ingroup_choices,'HUMANS');if(uncertain)throw Error('network response uncertain');return 'SUCCESS: ra_call_control transferred - 9001|call|HUMANS';}}});
  a.script_snapshot={script:'Ask age.'};a.conversation_history=[{role:'user',content:'I am 65.'}];
  a.qualification={steps:[{id:'age',requirement:'Ask age.',kind:'customer_answer',conditional:false}],stepChecks:[{id:'age',status:'complete',customerEvidence:['I am 65.'],agentEvidence:[]}],scriptHash:results.qualificationHash(a.script_snapshot),historyHash:results.conversationHash(a.conversation_history)};
  a.handoff_ready=false;await assert.rejects(results.transferVicidialCall('call'),/not eligible/);assert.equal(commands,0);a.handoff_ready=true;
  // A stale saved boolean is insufficient; re-evaluate the actual words before any native action.
  await assert.rejects(results.transferVicidialCall('call'),/not eligible/);assert.equal(commands,0);
  a.conversation_history.push({role:'assistant',content:'Let me connect you with a licensed specialist.'},{role:'user',content:'Why do you want to connect me with the licensed agent?'});
  a.qualification.historyHash=results.conversationHash(a.conversation_history);
  await assert.rejects(results.transferVicidialCall('call'),/not eligible/);assert.equal(commands,0);
  a.conversation_history.push({role:'assistant',content:'Would you like me to connect you?'},{role:'user',content:'Yes.'});
  a.qualification.historyHash=results.conversationHash(a.conversation_history);
  await assert.rejects(results.transferVicidialCall('call'),/No human agent/);assert.equal(commands,0);
  waiting=1;uncertain=true;await assert.rejects(results.transferVicidialCall('call'),/uncertain/);assert.equal(commands,1);assert.equal(a.transfer_status,'UNCERTAIN');
  await assert.rejects(results.transferVicidialCall('call'),/already submitted/);assert.equal(commands,1);
  a.transfer_status='';uncertain=false;await results.transferVicidialCall('call');assert.equal(commands,2);assert.equal(a.transfer_status,'SUBMITTED');
});

test('website playback exposes only the private AI recording, never the native human recording',async()=>{
  const http=require('node:http'),secret='fixture-recording-secret-at-least-32-characters',recordingId=crypto.randomUUID();let stored,requests=0;
  const server=http.createServer((req,res)=>{requests++;assert.equal(req.url,`/recordings/${recordingId}.wav`);assert.equal(signing.verifyBridgeSignature(secret,req.headers['x-shahvex-timestamp'],req.headers['x-shahvex-signature'],'GET',req.url,Buffer.alloc(0)),true);assert.equal(req.headers.range,'bytes=0-3');res.writeHead(206,{'content-type':'audio/wav','content-range':'bytes 0-3/100','accept-ranges':'bytes'});res.end('RIFF');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}/`,saved=process.env.SHAHVEX_VOIP_ALLOWED_HOSTS;process.env.SHAHVEX_VOIP_ALLOWED_HOSTS='127.0.0.1';
  const c={recording_serial:'42',ai_recording_id:null,recording_url:'',live_config:{...liveConfig,bridgeUrl:base,recordingBaseUrl:base},server_url:'https://dialer.example.test',username:'api',secret_ciphertext:'key',bridge_secret_ciphertext:secret,vicidial_lead_id:'234',vicidial_agent_user:'9001',vicidial_lead_id:'234'};
  const query=async(sql,p)=>{if(sql.startsWith('SELECT a.*')||sql.startsWith('SELECT a.recording_serial,a.ai_recording_id'))return {rows:[c]};if(sql.startsWith('UPDATE agent_calls')){stored=p;c.vicidial_recording_url=p[0];return {rows:[]};}throw Error('Unexpected recording SQL');};
  const service=load('lib/vicidial-recording.ts',{'./database':{db:async()=>({query})},'./vicidial':{...vici,vicidialRequest:async()=>`start_time|user|recording_id|lead_id|duration|location\n2026-11-11 12:00:00|9001|42|234|60|${base}full-human-recording.wav`},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-config':config,'./vicidial-bridge':signing});
  try{
    assert.equal(await service.syncVicidialRecording('call'),false);assert.equal(stored[0],base+'full-human-recording.wav');assert.equal(c.recording_url,'');
    assert.equal((await service.vicidialRecordingResponse('call',new Request('https://website.example.test/recording'))).status,404);assert.equal(requests,0);
    c.ai_recording_id=recordingId;
    const response=await service.vicidialRecordingResponse('11111111-1111-4111-8111-111111111111',new Request('https://website.example.test/recording?inline=1',{headers:{range:'bytes=0-3'}}));
    assert.equal(response.status,206);assert.equal(await response.text(),'RIFF');assert.equal(requests,1);assert.match(response.headers.get('content-disposition'),/^inline/);assert.match(response.headers.get('content-disposition'),/recording-REC-000042\.wav/);assert.equal(response.headers.get('x-recording-serial'),'REC-000042');
  }finally{await new Promise(r=>server.close(r));if(saved===undefined)delete process.env.SHAHVEX_VOIP_ALLOWED_HOSTS;else process.env.SHAHVEX_VOIP_ALLOWED_HOSTS=saved;}
});

test('BPO script library accepts a calling script without any number sheet',async()=>{
  let saved;
  const api=load('app/api/bpo/scripts/route.ts',{
    mammoth:{},xlsx:{},'@/lib/bpo-session':{requireApprovedBpo:async()=>({agentId:'bpo'})},
    '@/lib/database':{db:async()=>({query:async(sql,p)=>{if(sql.startsWith('INSERT INTO script_assignments'))saved=p;return {rows:[]};}})},
    '@/lib/bpo-storage':{getBpoStorageSummary:async()=>({hasActivePlan:true,usedBytes:0,limitBytes:1000000})},
    '@/lib/email':{sendMail:async()=>{throw Error('No email should be sent by this test');}},'@/lib/email-templates':{},
  });
  const form=new FormData();form.append('script',new File(['Ask the customer name.'],'script.txt',{type:'text/plain'}));
  const response=await api.POST(new Request('http://localhost:3000/api/bpo/scripts',{method:'POST',body:form}));
  assert.equal(response.status,201);assert.equal(saved[2],'');assert.equal(saved[6],'[]');assert.equal(saved[7],'[]');assert.equal(saved[8],'Ask the customer name.');assert.equal(saved[9],0);
});

test('AI recording is immutable after handoff and an interrupted partial file can be recovered',()=>{
  const recording=require('../deployment/vicidial-bridge/ai-recording.cjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-vici-'));
  try{
    const id=crypto.randomUUID(),rec=recording.createAiRecording(folder,id),customer=Buffer.alloc(320),ai=Buffer.alloc(320);
    customer.writeInt16LE(1234);ai.writeInt16LE(2345);rec.frame(customer,ai);const result=rec.finish(),before=fs.readFileSync(result.file);
    rec.frame(Buffer.alloc(320,33),Buffer.alloc(320,44));assert.deepEqual(fs.readFileSync(result.file),before);assert.equal(before.readInt16LE(44),1234);assert.equal(before.readInt16LE(46),2345);
    const crashed=crypto.randomUUID();fs.writeFileSync(path.join(folder,crashed+'.part'),Buffer.concat([Buffer.alloc(44),Buffer.alloc(640,12),Buffer.alloc(3)]));
    const restored=recording.recoverAiRecording(folder,crashed),audio=fs.readFileSync(restored.file);assert.equal(audio.length,684);assert.equal(audio.toString('ascii',0,4),'RIFF');assert.equal(audio.readUInt32LE(40),640);
  }finally{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('shahvex-vici-'));fs.rmSync(folder,{recursive:true,force:true});}
});

test('confirmed native transfer plus AI-leg closure completes the bot without waiting for human answer',async()=>{
  const connectionId=crypto.randomUUID(),secret='fixture-handoff-secret-of-at-least-32-characters',callId=crypto.randomUUID();
  const c={id:connectionId,enabled:true,live_config:liveConfig,bridge_secret_ciphertext:secret,secret_ciphertext:'api-key',username:'api',server_url:'https://dialer.example.test'};
  const call={id:callId,agent_id:'ai-agent',status:'ANSWERED',transfer_status:'SUBMITTED',vicidial_lead_id:'234',voice_session_id:null,conversation_history:[{role:'user',content:'My name is Ada.'}],script_snapshot:{script:'Collect name.'},collected_fields:{Name:{value:'Ada'}}};
  let nativeLead='wrong',writes=0;
  const query=async(sql,p=[])=>{
    if(sql.startsWith('SELECT * FROM voip_connections'))return {rows:[c]};
    if(sql.startsWith('SELECT * FROM agent_calls'))return {rows:[call]};
    if(sql.startsWith('INSERT INTO vicidial_events'))return {rows:[{event_id:p[1]}],rowCount:1};
    if(sql.includes('ai_media_ended_at=COALESCE')){call.ai_leg_released=true;call.conversation_state='AWAITING_HUMAN';return {rows:[]};}
    if(sql.includes("SET transfer_status='ANSWERED'")){writes++;Object.assign(call,{transfer_status:'ANSWERED',conversation_state:'HUMAN_CONNECTED'});return {rows:[]};}
    if(sql.startsWith('UPDATE vicidial_events'))return {rows:[{event_id:'event'}],rowCount:1};
    if(sql.includes("SET status=CASE WHEN status='FAILED'")){Object.assign(call,{status:'COMPLETED',conversation_state:'HANDED_OFF'});return {rows:[]};}
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('UPDATE ai_agent_runtime_states')||sql.startsWith('UPDATE voip_connections')||sql.startsWith('UPDATE ai_transfer_attempts'))return {rows:[]};
    throw Error('Unexpected handoff SQL: '+sql);
  };
  const database={db:async()=>({query,connect:async()=>({query,release(){}})})};
  const handoff=load('lib/vicidial-handoff.ts',{'./database':database,'./vicidial':{vicidialRequest:async()=>`status|lead_id\nINCALL|${nativeLead}`},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-config':config});
  const service=load('lib/vicidial-callback.ts',{'server-only':{},'./database':database,'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':signing,'./vicidial':{},'./vicidial-config':config,'./agent-test':{sessions:new Map()},'./agent-test-speculative':{},'./pc-ai-engine':{},'./vicidial-results':{hasRequestedHumanHandoff:()=>false,collectVicidialResult:async()=>({consent:false}),syncVicidialComments:async()=>{}},'./vicidial-recording':{syncVicidialRecording:async()=>true},'./vicidial-queue':{},'./vicidial-handoff':handoff,'./bpo-entitlements':{}});
  const post=async(action,extra={})=>{const body=Buffer.from(JSON.stringify({action,eventId:crypto.randomUUID(),externalCallId:'Y0316001655000402028',callId,...extra})),stamp=String(Date.now());return service.vicidialCallback(new Request('https://website.example.test/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connectionId,'x-shahvex-timestamp':stamp,'x-shahvex-signature':signing.bridgeSignature(secret,stamp,'POST','/api/telephony/vicidial',body)},body}));};
  assert.equal((await post('ended')).status,200);assert.equal(call.status,'COMPLETED');assert.equal(call.conversation_state,'HANDED_OFF');assert.equal(writes,0);
  await assert.rejects(post('human-answered',{humanUser:'9001'}),/AI line/);assert.equal(writes,0);
  await assert.rejects(post('human-answered',{humanUser:'human-1'}),/not confirmed/);assert.equal(call.status,'COMPLETED');
  nativeLead='234';assert.equal((await post('human-answered',{humanUser:'human-1'})).status,200);assert.equal(call.status,'COMPLETED');assert.equal(call.transfer_status,'ANSWERED');assert.equal(call.conversation_state,'HANDED_OFF');assert.equal(writes,1);
  assert.deepEqual(call.collected_fields,{Name:{value:'Ada'}});assert.equal(call.conversation_history.length,1);
});


test('direct UUID prefix resolution requires a ready owned agent and a native INCALL in the exact campaign',async()=>{
 const connectionId=crypto.randomUUID(),secret='fixture-prefix-secret-of-at-least-32-characters',uuid='3531'+crypto.randomUUID().slice(4);
 let ready=true,nativeStatus='INCALL',campaign='TEST',nativeReads=0,callHeader='call_id';
 const configured={...liveConfig,directAudioLines:[{prefix:'3531',remoteUser:'9001',agentId:'agent-a'}]};
 const query=async(sql,p)=>{
  if(sql.startsWith('SELECT * FROM voip_connections'))return {rows:[{id:connectionId,owner_id:'owner',enabled:true,media_verified_at:new Date(),live_config:configured,bridge_secret_ciphertext:secret,secret_ciphertext:'key'}]};
  if(sql.startsWith('SELECT d.external_campaign_id')){assert.deepEqual(p,['agent-a',connectionId,'9001','owner']);assert.match(sql,/rs.state='READY'/);return {rows:ready?[{external_campaign_id:'TEST'}]:[]};}
  throw Error('Unexpected prefix SQL');
 };
 const callback=load('lib/vicidial-callback.ts',{'server-only':{},'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':signing,'./vicidial':{vicidialRequest:async()=>{nativeReads++;return `status|${callHeader}|lead_id|campaign_id\n${nativeStatus}|${callHeader.includes('|')?'| ':''}Y0316001655000402028 |234|${campaign}`}},'./vicidial-config':config,'./agent-test.ts':{},'./agent-test-speculative.ts':{},'./pc-ai-engine.ts':{},'./vicidial-results':{},'./bpo-entitlements':{},'./vicidial-recording':{},'./vicidial-queue':{},'./vicidial-handoff':{},'./vicidial-admission-recovery':{recoverPreviousCallForAdmission:async()=>false}}).vicidialCallback;
 async function post(audioUuid=uuid){const body=Buffer.from(JSON.stringify({action:'resolve-prefix',eventId:crypto.randomUUID(),externalCallId:audioUuid.replaceAll('-',''),audioUuid})),t=String(Date.now());return callback(new Request('https://site.example.test/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connectionId,'x-shahvex-timestamp':t,'x-shahvex-signature':signing.bridgeSignature(secret,t,'POST','/api/telephony/vicidial',body)},body}));}
 assert.equal((await post('9999'+uuid.slice(4))).status,409);assert.equal(nativeReads,0);
 ready=false;assert.equal((await post()).status,409);assert.equal(nativeReads,0);
 ready=true;nativeStatus='READY';assert.equal((await post()).status,409);
 nativeStatus='INCALL';campaign='OTHER';assert.equal((await post()).status,409);
 campaign='TEST';const result=await post();assert.equal(result.status,200);assert.deepEqual(await result.json(),{uuid,audioUuid:uuid,agentUser:'9001',externalCallId:'Y0316001655000402028'});
 callHeader='call_id|callerid';const legacy=await post();assert.equal(legacy.status,200);assert.equal((await legacy.json()).externalCallId,'Y0316001655000402028');
 configured.directAudioMode=true;ready=false;const pending=await post();assert.equal(pending.status,409);assert.equal((await pending.json()).retryable,true);ready=true;const hybrid=await post();assert.equal((await hybrid.json()).externalCallId,'direct-'+uuid.replaceAll('-',''));nativeStatus='READY';const fallback=await post();assert.equal((await fallback.json()).externalCallId,'direct-'+uuid.replaceAll('-',''));campaign='OTHER';nativeStatus='INCALL';assert.equal((await (await post()).json()).externalCallId,'direct-'+uuid.replaceAll('-',''));
});

test('three direct prefixes receive isolated audio and duplicate active call legs are refused',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-prefix-')),secret='fixture-prefix-bridge-secret-at-least-32-characters',connectionId=crypto.randomUUID(),events=[];
 const prefixes=['3531','3532','3533'],ids=new Map(prefixes.map(p=>[p,crypto.randomUUID()])),external=p=>'Y031600165500040'+p;
 const b=bridge.createBridge({siteUrl:'https://site.example.test/',connectionId,secret,spoolDir:folder,maxCalls:4,logger:()=>{},resolveRegistration:async uuid=>{const p=uuid.slice(0,4);if(!ids.has(p))throw Error('Unknown prefix');return {uuid,audioUuid:uuid,agentUser:'900'+(prefixes.indexOf(p)+1),externalCallId:external(p)}},fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);events.push(v);if(v.action==='connected')return Response.json({callId:ids.get(v.audioUuid.slice(0,4)),first:'ai'});if(v.action==='turn'){const p=[...ids].find(([,id])=>id===v.callId)[0];const pcm=Buffer.alloc(1920);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Number(p),i);return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:pcm.toString('base64')})+'\n');}return Response.json({saved:true})}});
 const sockets=[];try{
  await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));const results=[];
  for(const p of prefixes){const s=net.connect(b.audio.address().port,'127.0.0.1');sockets.push(s);await new Promise(r=>s.once('connect',r));let carry=Buffer.alloc(0);const values=[];results.push(values);s.on('data',chunk=>{carry=Buffer.concat([carry,chunk]);while(carry.length>=3&&carry.length>=3+carry.readUInt16BE(1)){const n=carry.readUInt16BE(1);if(carry[0]===0x10&&n>=2)values.push(carry.readInt16LE(3));carry=carry.subarray(3+n)}});s.write(bridge.packet(1,Buffer.from((p+crypto.randomUUID().slice(4)).replaceAll('-',''),'hex')));}
  const until=Date.now()+2000;while(results.some(x=>x.length<2)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  results.forEach((values,i)=>{assert.ok(values.length>=2);assert.ok(values.slice(1).every(x=>x===Number(prefixes[i])))});assert.equal(events.filter(e=>e.action==='connected').length,3);
  const duplicate=net.connect(b.audio.address().port,'127.0.0.1');sockets.push(duplicate);await new Promise(r=>duplicate.once('connect',r));const closed=new Promise(r=>duplicate.once('close',r));duplicate.write(bridge.packet(1,Buffer.from(('3531'+crypto.randomUUID().slice(4)).replaceAll('-',''),'hex')));await closed;assert.equal(events.filter(e=>e.action==='connected').length,3);
 }finally{sockets.forEach(s=>s.destroy());await new Promise(r=>setTimeout(r,40));await b.flushEvents();b.close();fs.rmSync(folder,{recursive:true,force:true});}
});

test('opt-in direct audio starts the exact script/voice without native identity, rejects busy agents, and waits for native teardown',async()=>{
 const connectionId=crypto.randomUUID(),secret='fixture-direct-mode-secret-at-least-32-characters',uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');
 const shared=load('lib/agent-test.ts',{'server-only':{}});let current,ready=true,created=0,native=0,reconciliationChecks=0,nativeState='INCALL';
 const live={...liveConfig,directAudioMode:true,directAudioLines:[{prefix:'3531',remoteUser:'9001',agentId:'agent-a'}]};
 const row=x=>({rows:x?[x]:[],rowCount:x?1:0});
 const query=async(sql,p=[])=>{
  if(sql.startsWith('SELECT * FROM voip_connections'))return row({id:connectionId,owner_id:'owner',enabled:true,media_verified_at:new Date(),live_config:live,bridge_secret_ciphertext:secret,secret_ciphertext:'key'});
  if(sql.startsWith('SELECT d.external_campaign_id'))return row(ready?{external_campaign_id:'TEST'}:null);
  if(sql.startsWith('INSERT INTO vicidial_events')||sql.startsWith('UPDATE vicidial_events'))return row({event_id:'event'});
  if(sql.startsWith('SELECT * FROM agent_calls'))return row(current?.direct_audio_uuid===p[1]?current:null);
  if(sql.startsWith('SELECT a.id,a.name,a.local_voice_id,q.config'))return row(ready?{id:'agent-a',name:'Assigned Zulekha',local_voice_id:'olivia',campaign_id:'campaign',external_campaign_id:'TEST',script:'Use the exact campaign script.',config:{name:'old',voice:'lissa',first:'ai',goal:'Ask name',task:'Ask name',instructions:'',script:'old',knowledge:'',style:'Friendly'}}:null);
  if(sql.startsWith('INSERT INTO agent_calls')){assert.match(sql,/'AUDIOSOCKET'/);assert.doesNotMatch(sql,/vicidial_call_id|vicidial_lead_id/);created++;current={id:p[0],agent_id:p[1],direct_audio_uuid:p[3],direct_audio_line:p[4],external_campaign_id:p[6],telephony_provider:'AUDIOSOCKET',status:'INITIATED',script_snapshot:JSON.parse(p[7]),vicidial_call_id:null,vicidial_lead_id:null,conversation_history:[]};return row(current);}
  if(sql.startsWith('UPDATE agent_calls SET voice_session_id')){current.voice_session_id=p[0];return row(current);}
  if(sql.startsWith('UPDATE agent_calls SET ai_leg_released')){current.ai_leg_released=true;return row(current);}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory'))return row(null);
  throw Error('Unexpected direct fixture SQL: '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const callback=load('lib/vicidial-callback.ts',{'server-only':{},'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:v=>v},'./vicidial-bridge':signing,'./vicidial':{vicidialRequest:async()=>{native++;return 'status|campaign_id\n'+nativeState+'|TEST'}},'./vicidial-config':config,'./agent-test.ts':shared,'./agent-runtime':{reserveAgent:async()=>{if(!ready)return false;ready=false;return true},mediaReady:async()=>{current.status='ANSWERED';return true},releaseConfirmedAgent:async()=>{if(!current.customer_ended)return false;current.status='COMPLETED';ready=true;return true},setRuntimeState:async()=>{}},'./agent-test-speculative.ts':{},'./pc-ai-engine.ts':{},'./vicidial-results':{},'./bpo-entitlements':{},'./vicidial-recording':{},'./vicidial-queue':{queueAgentAllowed:async()=>true},'./vicidial-handoff':{},'./vicidial-call-reconciliation':{reconcileMissingVicidialCalls:async(_connection,_key,activeIds,_stop,callId)=>{assert.deepEqual(activeIds,[]);assert.equal(callId,current.id);reconciliationChecks++;return false;}}}).vicidialCallback;
 async function post(value){const body=Buffer.from(JSON.stringify({eventId:crypto.randomUUID(),externalCallId:external,...value})),t=String(Date.now());return callback(new Request('https://site.example.test/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':connectionId,'x-shahvex-timestamp':t,'x-shahvex-signature':signing.bridgeSignature(secret,t,'POST','/api/telephony/vicidial',body)},body}));}
 const resolved=await post({action:'resolve-prefix',audioUuid:uuid});assert.equal(resolved.status,200);assert.equal((await resolved.json()).externalCallId,external);
 assert.equal((await post({action:'connected',audioUuid:uuid,agentUser:'9001'})).status,200);assert.equal(created,1);assert.equal(current.script_snapshot.name,'Assigned Zulekha');assert.equal(current.script_snapshot.voice,'olivia');assert.equal(current.script_snapshot.script,'Use the exact campaign script.');assert.equal(current.vicidial_call_id,null);assert.equal(current.vicidial_lead_id,null);
 assert.equal((await post({action:'connected',audioUuid:uuid,agentUser:'9001'})).status,200);assert.equal(created,1);
 const other='3531'+crypto.randomUUID().slice(4);assert.equal((await post({action:'connected',externalCallId:'direct-'+other.replaceAll('-',''),audioUuid:other,agentUser:'9001'})).status,409);
 const id=current.id;assert.equal((await post({action:'media-ready',callId:id})).status,200);assert.equal(current.status,'ANSWERED');
 assert.equal((await post({action:'retry-sync',callId:id})).status,200);assert.equal((await post({action:'human-answered',callId:id,humanUser:'human1'})).status,409);
 const session=current.voice_session_id;assert.ok(shared.sessions.has(session));const pending=await post({action:'ended',callId:id,durationSeconds:4});assert.equal(pending.status,200);assert.equal((await pending.json()).cleanupPending,true);
 assert.equal(reconciliationChecks,1);assert.equal(current.status,'ANSWERED');assert.equal(ready,false);assert.equal(shared.sessions.has(session),false);
 // The independently tested bridge/native reconciler supplies confirmation.
 current.customer_ended=true;const repeated=await post({action:'ended',callId:id,durationSeconds:4});
 assert.equal(repeated.status,200);assert.equal((await repeated.json()).nativeSync,'NOT_APPLICABLE');
 assert.equal(current.status,'COMPLETED');assert.equal(ready,true);assert.equal(native,0);
 nativeState='INCALL';
 const stale=await post({action:'retry-sync',callId:id});
 assert.equal((await stale.json()).nativeSync,'NOT_APPLICABLE');
 assert.equal(native,0);assert.equal(current.vicidial_call_id,null);
});

test('direct audio controls close only the bridge and refuse native transfer and sync',async()=>{
 let native=0;const commands=[];const api=load('lib/vicidial-controls.ts',{'./database':{db:async()=>({query:async()=>({rows:[{id:'call',telephony_provider:'AUDIOSOCKET',status:'ANSWERED',live_config:liveConfig,bridge_secret_ciphertext:'secret'}]})})},'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{vicidialRequest:async()=>{native++}},'./vicidial-config':config,'./vicidial-bridge':{requestBridge:async(_url,_secret,_path,v)=>{commands.push(v);return {accepted:true}}},'./vicidial-results':{syncVicidialComments:async()=>{native++},transferVicidialCall:async()=>{native++}}});
 assert.equal((await api.vicidialCallCommand('call','transfer')).status,409);assert.equal((await api.vicidialCallCommand('call','sync-comments')).status,409);assert.equal((await api.vicidialCallCommand('call','hangup')).status,200);assert.deepEqual(commands,[{callId:'call',action:'close-audio'}]);assert.equal(native,0);
});

test('explicit skipped Yes branch retains actual No evidence and spoken transfer statement',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 const source="Do you get a rebate?\n\nIf customer say yes\nYou may qualify for more.\n\nIf customer says No\nDo you have coverage?";
 const steps=[{id:'yes',requirement:'You may qualify for more.',kind:'agent_statement',conditional:true}];
 const checks=[{id:'yes',status:'not_applicable',customerEvidence:[],agentEvidence:[]}];
 const history=[{role:'assistant',content:'Do you get a rebate?'},{role:'user',content:'No, I do not.'}];
 const fixed=api.repairExplicitBranchChecks(steps,checks,history,source);assert.deepEqual(fixed[0].customerEvidence,['No, I do not.']);assert.equal(api.groundedHandoff(steps,fixed,history),true);
 const noStep=[{id:'no',requirement:'Do you have coverage?',kind:'customer_answer',conditional:true}];const noCheck=[{id:'no',status:'not_applicable',customerEvidence:[],agentEvidence:[]}];const yesHistory=[history[0],{role:'user',content:'Yes, I do.'}];const noFixed=api.repairExplicitBranchChecks(noStep,noCheck,yesHistory,source);assert.equal(api.groundedHandoff(noStep,noFixed,yesHistory),true);
 const unanswered=api.repairExplicitBranchChecks(steps,checks,history.slice(0,1),source);assert.equal(api.groundedHandoff(steps,unanswered,history.slice(0,1)),false);
 const unrelated=api.repairExplicitBranchChecks(steps,checks,[{role:'assistant',content:'Are you married?'},{role:'user',content:'No.'}],source);assert.deepEqual(unrelated[0].customerEvidence,[]);
});

test('question-aligned customer answers survive polite prefixes and cannot satisfy an unrelated question',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 const steps=[{id:'age',requirement:'Are you between 60 and 80?',kind:'customer_answer',conditional:false}],checks=[{id:'age',status:'missing',customerEvidence:[],agentEvidence:[]}];
 const history=[{role:'assistant',content:'Got it. Are you between 60 and 80?'},{role:'user',content:'Okay, yeah.'}];
 assert.equal(api.groundedHandoff(steps,api.repairExplicitBranchChecks(steps,checks,history,steps[0].requirement),history),true);
 const unrelated=[{role:'assistant',content:'Do you have coverage?'},{role:'user',content:'Yes.'}];assert.equal(api.groundedHandoff(steps,api.repairExplicitBranchChecks(steps,checks,unrelated,steps[0].requirement),unrelated),false);
});

test('bot release requires confirmed transfer and actual AI leg closure; uncertainty stays busy',async()=>{
 for(const [transfer,closed,expected] of [['SUBMITTED',true,true],['SUBMITTED',false,false],['UNCERTAIN',true,false],['FAILED',true,false]]){
  const call={id:'call',ai_leg_released:closed,customer_ended:false,transfer_status:transfer};let completed=false;
  const query=async sql=>{if(sql.startsWith('SELECT * FROM agent_calls'))return {rows:[call]};if(sql.includes("SET status=CASE"))completed=true;return {rows:[]};};
  const runtime=load('lib/agent-runtime.ts',{'./database':{db:async()=>({connect:async()=>({query,release(){}})})}});
  assert.equal(await runtime.releaseConfirmedAgent('call'),expected);assert.equal(completed,expected);
 }
});

test('presence checks do not erase a pending verification answer with a spoken filler',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 const question='Are you getting a rebate each month?',source=question+'\nIf customer says No\nGot it, Do you have coverage?';
 const steps=[{id:'rebate',requirement:question,kind:'customer_answer',conditional:false},{id:'coverage',requirement:'Do you have coverage?',kind:'customer_answer',conditional:true}];
 const checks=steps.map(s=>({id:s.id,status:'missing',customerEvidence:[],agentEvidence:[]}));
 const history=[{role:'assistant',content:question},{role:'user',content:'Hello?'},{role:'assistant',content:"Yes, I'm here."},{role:'user',content:'Uh, yes. I get two hundred each month.'}];
 assert.equal(api.groundedHandoff(steps,api.repairExplicitBranchChecks(steps,checks,history,source),history),true);
 const unrelated=[{role:'assistant',content:question},{role:'user',content:'Are you married?'},{role:'assistant',content:'Would you like to continue?'},{role:'user',content:'Yes.'}];assert.equal(api.groundedHandoff(steps,api.repairExplicitBranchChecks(steps,checks,unrelated,source),unrelated),false);
});

test('verified question answers populate handoff information even when the model omits structured fields',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 const steps=[{id:'rebate',kind:'customer_answer',conditional:false,requirement:'Are you getting a rebate each month?'},{id:'age',kind:'customer_answer',conditional:false,requirement:'Are you between 60 and 80 years old?'}];
 const history=[{role:'user',content:'Yes, I get two hundred dollars each month.'},{role:'user',content:'Yes, I am seventy one.'}];
 const checks=steps.map((s,i)=>({id:s.id,status:'complete',customerEvidence:[history[i].content],agentEvidence:[]}));
 const fields=api.verifiedQuestionFields(steps,checks,history);assert.equal(fields.rebate.value,history[0].content);assert.equal(fields.age_range.value,history[1].content);assert.equal(fields.name,undefined);
});

test('new consent and handoff notes trigger native comment sync even when collected fields are unchanged',async()=>{
 const revisions=[],a={id:'call',voip_connection_id:'connection',collected_fields:{age:{value:'71'}},outcome:'TASKS_COMPLETED',transfer_consent:false,handoff_ready:true,qualification:{handoffNotes:[]},script_snapshot:{},secret_ciphertext:'key',vicidial_lead_id:'234'};let comments='Operator note';
 const query=async(sql,p=[])=>{if(sql.startsWith('SELECT a.*'))return {rows:[a]};if(sql.startsWith('INSERT INTO vicidial_sync_jobs'))revisions.push(p[3]);if(sql.startsWith("UPDATE vicidial_sync_jobs SET state='RUNNING'"))return {rows:[{id:'job'}]};return {rows:[],rowCount:1};};
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-config':config,'./vicidial':{requireVicidialSuccess:x=>x,vicidialRequest:async(_s,_u,_k,p)=>{if(p.function==='lead_all_info')return 'lead_id|comments\n234|'+comments;if(p.function==='update_lead'){comments=p.comments;return 'SUCCESS: update_lead updated';}throw Error('Unexpected operation')}}});
 await api.syncVicidialComments('call');a.transfer_consent=true;await api.syncVicidialComments('call');assert.match(comments,/Transfer consent: yes/);a.qualification.handoffNotes=[{kind:'need',evidence:'Please call after lunch'}];await api.syncVicidialComments('call');assert.match(comments,/Please call after lunch/);assert.equal(new Set(revisions).size,3);assert.ok(comments.startsWith('Operator note'));
});

test('verification question extraction excludes the sales pitch and retains the actual interrogative',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 assert.equal(api.verificationQuestion('I am calling because you may be owed a rebate and lots of people are overcharged. Are you getting money back?'),'Are you getting money back?');
 assert.equal(api.verificationQuestion('I am calling because you may be owed a rebate, Are you getting money back?'),'Are you getting money back?');
 assert.equal(api.verificationQuestion('How old are you?'),'How old are you?');
});

test('handoff fields use matching native boxes and retain unmapped or conflicting information in comments',()=>{
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 const fields={name:{value:'Test Person'},phone:{value:'+1 (555) 123-4567'},email:{value:'test@example.com'},rebate:{value:'$200/month'},age_range:{value:'71'}};
 const plan=api.planNativeLeadFields(fields,{phone_number:'5551234567',phone_code:'1'});
 assert.equal(plan.updates.first_name,'Test');assert.equal(plan.updates.last_name,'Person');assert.equal(plan.updates.phone_number,'5551234567');assert.equal(plan.updates.email,'test@example.com');assert.equal(plan.comments.rebate.value,'$200/month');assert.equal(plan.comments.age_range.value,'71');assert.equal(plan.comments.name,undefined);
 const invalidName=api.planNativeLeadFields({name:{value:"No I don't"}},{});assert.equal(invalidName.updates.first_name,undefined);assert.equal(invalidName.updates.last_name,undefined);assert.equal(invalidName.comments.name.value,"No I don't");
 const conflict=api.planNativeLeadFields({name:fields.name,phone:{value:'5559999999'}},{first_name:'Operator',phone_number:'5551234567',alt_phone:'5551111111'});assert.equal(conflict.updates.first_name,undefined);assert.equal(conflict.comments.name.value,'Test Person');assert.equal(conflict.comments.phone.value,'5559999999');
});


test('explicit transfer-my-call requests survive waiting turns and revoke on refusal without inventing qualification',async()=>{
 let saved;
 const api=load('lib/vicidial-results.ts',{'./agent-test':{},'./database':{db:async()=>({query:async(sql,args)=>{saved={sql,args};return {rowCount:1}}})},'./credential-crypto':{},'./vicidial':{},'./vicidial-config':{}});
 for(const text of ['Okay, transfer my calls. Transfer my call.','Please transfer this call.','Connect my call to a human.'])assert.equal(api.hasTransferConsent([{role:'user',content:text}]),true,text);
 const history=[{role:'user',content:'Transfer my call.'},{role:'assistant',content:'Please wait.'},{role:'user',content:'I am still waiting.'}];
 assert.equal(api.hasRequestedHumanHandoff(history),true);
 assert.equal(api.hasRequestedHumanHandoff([...history,{role:'user',content:"Don't transfer my call."}]),false);
 assert.equal(api.hasRequestedHumanHandoff([...history,{role:'user',content:"I don't want you to transfer my call."}]),false);
 assert.equal(api.hasTransferConsent([{role:'assistant',content:'May I connect you to a specialist?'},{role:'user',content:'All right.'}]),true);
 assert.equal(api.hasRequestedHumanHandoff([{role:'assistant',content:'Are you over 65?'},{role:'user',content:'Yes.'}]),false);
 await api.prepareRequestedHumanHandoff('call',history,{script:'Ask age first.'},{handoffNotes:[{kind:'preference',evidence:'Existing note'}]});
 const audit=JSON.parse(saved.args[0]);assert.equal(audit.goalAchieved,false);assert.equal(audit.mode,'CUSTOMER_REQUESTED_HUMAN');assert.equal(audit.handoffNotes[0].evidence,'Existing note');assert.match(saved.sql,/conversation_history=\$3/);assert.match(saved.sql,/collected_fields=collected_fields \|\| \$4/);assert.deepEqual(JSON.parse(saved.args[3]),{});
 assert.equal(api.hasCurrentQualification({script_snapshot:{script:'Ask age first.'},conversation_history:history,qualification:audit}),true);
 assert.equal(api.hasCurrentQualification({script_snapshot:{script:'Ask age first.'},conversation_history:[...history,{role:'user',content:"Don't transfer my call."}],qualification:audit}),false);
 await assert.rejects(api.prepareRequestedHumanHandoff('call',[{role:'user',content:'Hello'}],{}),/No current customer request/);
});

test('dedicated remote owners are never borrowed by another agent',async()=>{
 const lines=[{prefix:'3531',remoteUser:'9001',agentId:'agent-a'}];
 const direct=startHarness({liveOverride:{directAudioMode:true,directAudioLines:lines}});
 await assert.rejects(direct.service.startVicidialAgent('agent-b'),/dedicated extension route/);assert.equal(direct.activated,0);
 const pooled=startHarness({liveOverride:{directAudioLines:lines}});await pooled.service.startVicidialAgent('agent-b');assert.equal(pooled.agents.get('agent-b').remote_user,'9002');
});

test('reserved routes without a campaign cannot start native intake',async()=>{const h=startHarness({campaignId:''});await assert.rejects(h.service.startVicidialAgent('agent-a'),/Assign a campaign/);assert.equal(h.activated,0);assert.equal(h.agents.size,0);});
