const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
function load(file,deps={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:require(n),m,m.exports);return m.exports;}
const config=load('lib/campaign-config.ts');
test('script extraction derives goal, questions, lead fields and FAQs without invented fields',async()=>{
 const script='Collect name. What is your name? Answer billing FAQs.';
 const extract=load('lib/campaign-script-extraction.ts',{'./campaign-config':config,'./agent-script-extraction':{extractAgentScript:async()=>({goals:['Collect name.'],tasks:[],instructions:[],restrictions:[],conversationFlow:[],knowledge:[],faqs:['Answer billing FAQs.']})},'./agent-test':{engine:async()=>Response.json({message:{content:JSON.stringify({questions:['What is your name?','What is your bank account?'],leadFields:['name','bank account']})}})}});
 const result=await extract.extractCampaignScript('owner',script);assert.equal(result.goal,'Collect name.');assert.deepEqual(result.qualificationQuestions,['What is your name?']);assert.deepEqual(result.requiredLeadFields,['name']);assert.match(result.knowledge,/billing FAQs/);
});
function controller(query,extra={}){return load('lib/campaign-controller.ts',{'./agent-campaign-assignment':load('lib/agent-campaign-assignment.ts'),'./vicidial-config':load('lib/vicidial-config.ts'),'./database':{db:async()=>({query,connect:async()=>({query,release(){}})})},'./voip-controller':{principal:async()=> 'owner',controllerAgentSQL:'TRUE'},'./campaign-config':config,'./campaign-script-extraction':{extractCampaignScript:async()=>config.campaignSettings.parse({goal:'Extracted goal',requiredLeadFields:['name']})},'./credential-crypto':{},'./vicidial':{},...extra});}
const request=value=>new Request('https://site.example.test/api/admin/campaigns',{method:'POST',headers:{origin:'https://site.example.test'},body:JSON.stringify(value)});
test('campaign save accepts script alone and persists derived settings rather than manual goal overrides',async()=>{
 let saved;const connection=crypto.randomUUID();
 const api=controller(async(sql,p=[])=>{if(sql.startsWith('SELECT id FROM voip_connections'))return {rows:[{id:connection}]};if(sql.startsWith('INSERT INTO campaign_definitions')){saved=JSON.parse(p[8]);return {rows:[{id:p[0]}],rowCount:1};}if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};throw Error(sql);});
 const response=await api.postCampaigns(request({action:'save-campaign',name:'Campaign',connectionId:connection,externalId:'CAMP01',enabled:true,script:'Collect name.',settings:{goal:'Manual invented goal'}}),'admin');
 assert.equal(response.status,201);assert.equal(saved.goal,'Extracted goal');assert.deepEqual(saved.requiredLeadFields,['name']);
});
test('a BPO agent assigned to another campaign is rejected before any native or assignment mutation',async()=>{
 let writes=0;const campaign=crypto.randomUUID();
 const api=controller(async(sql)=>{if(sql.startsWith('SELECT * FROM campaign_definitions'))return {rows:[{id:campaign}]};if(sql.startsWith('SELECT a.id'))return {rows:[{id:'agent'}]};if(sql.startsWith('SELECT agent_id FROM campaign_agent_assignments'))return {rows:[{agent_id:'agent'}]};writes++;throw Error(sql);});
 const response=await api.postCampaigns(request({action:'assign',campaignId:campaign,agentIds:['agent']}),'bpo');assert.equal(response.status,409);assert.match((await response.json()).error,/only one campaign/);assert.equal(writes,0);
});
test('an admin agent assigned to another campaign is rejected before any native or assignment mutation',async()=>{
 let writes=0;const campaign=crypto.randomUUID();
 const api=controller(async(sql)=>{if(sql.startsWith('SELECT * FROM campaign_definitions'))return {rows:[{id:campaign}]};if(sql.startsWith('SELECT a.id'))return {rows:[{id:'agent'}]};if(sql.startsWith('SELECT agent_id FROM campaign_agent_assignments'))return {rows:[{agent_id:'agent'}]};writes++;throw Error(sql);});
 const response=await api.postCampaigns(request({action:'assign',campaignId:campaign,agentIds:['agent']}),'admin');assert.equal(response.status,409);assert.match((await response.json()).error,/only one campaign/);assert.equal(writes,0);
});
test('category removal detaches campaigns transactionally and retains agents and call history',async()=>{
 const writes=[];const api=controller(async(sql,p)=>{writes.push(sql);return {rows:sql.startsWith('SELECT')?[{id:p[0]}]:[]};});
 assert.equal((await api.postCampaigns(request({action:'delete-category',id:crypto.randomUUID()}),'admin')).status,200);
 assert.ok(writes.includes('BEGIN')&&writes.includes('COMMIT'));assert.ok(writes.some(s=>s.includes('SET category_id=NULL')));assert.ok(!writes.some(s=>/DELETE FROM (?:agents|agent_calls|campaign_definitions)/.test(s)));
});
test('BPO profile creation needs no connection, script or campaign and checks tenant voice ownership',async()=>{
 const writes=[];const query=async(sql,p=[])=>{writes.push({sql,p});if(sql.startsWith('SELECT id FROM agents'))return {rows:[{id:'owner'}]};if(sql.startsWith('SELECT COUNT'))return {rows:[{agents:0}]};if(sql.startsWith('SELECT id,name,accent')){assert.equal(p[1],'owner');assert.match(sql,/owner_id=\$2/);return {rows:[{id:'voice',name:'Voice',accent:'English'}]};}return {rows:[]};};
 const profile=load('lib/bpo-agent-profile.ts',{'./database':{db:async()=>({connect:async()=>({query,release(){}})})},'./bpo-entitlements':{bpoEntitlements:async()=>({agents:2})},bcryptjs:{hash:async()=> 'fixture-hash'}});
 const response=await profile.saveBpoAgentProfile('owner',{name:'AI Agent',gender:'FEMALE',voiceId:'voice',conversationStyle:'Friendly',speaksFirst:'customer'});assert.equal(response.status,201);assert.ok(writes.some(x=>x.sql.startsWith('INSERT INTO agents')));assert.ok(!writes.some(x=>/voip_connections|script_assignments|campaign_agent_assignments/.test(x.sql)));
});
test('controller campaign deletion stops intake, removes assignments and retains active call history',async()=>{
 const writes=[],stopped=[],id=crypto.randomUUID();
 const api=controller(async(sql,p=[])=>{writes.push(sql);if(sql.startsWith('SELECT * FROM campaign_definitions')){assert.equal(p[1],'owner');return {rows:[{id,connection_id:'connection',external_campaign_id:'CAMP01'}]};}if(sql.startsWith('UPDATE campaign_agent_assignments'))return {rows:[{agent_id:'agent'}]};return {rows:[]};},{'./vicidial-live':{stopVicidialAgent:async agent=>{assert.ok(writes.includes('COMMIT'));stopped.push(agent);}}});
 const response=await api.postCampaigns(request({action:'delete-campaign',campaignId:id}),'admin');assert.equal(response.status,200);assert.deepEqual(stopped,['agent']);
 assert.ok(writes.some(s=>s.includes('deleted_at=COALESCE')&&s.includes("intake_state='STOPPED'")));assert.ok(writes.some(s=>s.startsWith('DELETE FROM campaign_agent_assignments')));assert.ok(writes.some(s=>s.includes("state='OFFLINE'")&&s.includes('call_id IS NULL')));
 assert.ok(!writes.some(s=>/DELETE FROM (?:agents|agent_calls|campaign_definitions)|UPDATE agent_calls/.test(s)));
});
test('campaign deletion rejects foreign ownership and BPO requests without mutations',async()=>{
 let mutations=0;const api=controller(async sql=>{if(sql.startsWith('SELECT'))return {rows:[]};if(!['BEGIN','ROLLBACK'].includes(sql))mutations++;return {rows:[]};});
 const payload={action:'delete-campaign',campaignId:crypto.randomUUID()};assert.equal((await api.postCampaigns(request(payload),'admin')).status,404);assert.equal((await api.postCampaigns(request(payload),'bpo')).status,403);assert.equal(mutations,0);
});
test('uncertain native shutdown is reported while the deleted campaign stays unavailable',async()=>{
 const id=crypto.randomUUID();let archived=false;
 const api=controller(async sql=>{if(sql.startsWith('SELECT * FROM campaign_definitions'))return {rows:[{id}]};if(sql.startsWith('UPDATE campaign_agent_assignments'))return {rows:[{agent_id:'agent'}]};if(sql.includes('deleted_at=COALESCE'))archived=true;return {rows:[]};},{'./vicidial-live':{stopVicidialAgent:async()=>{throw Error('timeout');}}});
 const response=await api.postCampaigns(request({action:'delete-campaign',campaignId:id}),'admin');assert.equal(response.status,207);assert.ok(archived);assert.match((await response.json()).message,/shutdown needs verification/);
});
test('campaign start requires its verified AI audio connection and assigned agents',async()=>{
 const id=crypto.randomUUID(),d={id,enabled:true,script:'Collect name.',external_campaign_id:'CAMP01',connection_enabled:true,connection_status:'NOT_TESTED',live_config:{enabled:true,remoteUsers:['9001'],transferInGroup:'HUMANS',bridgeUrl:'https://bridge.example.test',recordingEnabled:true},bridge_secret_ciphertext:'encrypted',media_verified_at:new Date()};let native=0,running=0;
 const api=controller(async sql=>{if(sql.startsWith('SELECT d.*'))return {rows:[d]};if(sql.startsWith('SELECT x.agent_id'))return {rows:[]};if(sql.includes('SET intake_state='))running++;return {rows:[]};},{'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{vicidialRequest:async()=>{native++;return 'campaign_id|active\nCAMP01|Y';}}});
 const start=()=>api.postCampaigns(request({action:'start',campaignId:id}),'admin');
 assert.equal((await start()).status,409);assert.equal(native,0);d.connection_status='CONNECTED';d.media_verified_at=null;
 assert.equal((await start()).status,409);assert.equal(native,0);d.media_verified_at=new Date();
 const unassigned=await start();assert.equal(unassigned.status,409);assert.match((await unassigned.json()).error,/Assign at least one/);assert.equal(running,0);
});
test('campaign calling connects free agents only and preserves busy or already ready instances',async()=>{
 const id=crypto.randomUUID(),started=[];let running=false;
 const d={id,enabled:true,script:'Collect name.',external_campaign_id:'CAMP01',connection_enabled:true,connection_status:'CONNECTED',live_config:{enabled:true,remoteUsers:['9001','9002','9003'],transferInGroup:'HUMANS',bridgeUrl:'https://bridge.example.test',recordingEnabled:true},bridge_secret_ciphertext:'encrypted',media_verified_at:new Date()};
 const api=controller(async(sql,p=[])=>{if(sql.startsWith('SELECT d.*'))return {rows:[d]};if(sql.startsWith('SELECT x.agent_id'))return {rows:[{agent_id:'free',runtime_state:'OFFLINE'},{agent_id:'busy',call_id:'live-call',runtime_state:'BUSY'},{agent_id:'ready',ready:true,runtime_state:'READY'}]};if(sql.includes('SET intake_state='))running=p[0]==='RUNNING';return {rows:[]};},{'./credential-crypto':{decryptCredential:v=>v},'./vicidial':{vicidialRequest:async(_u,_n,_s,p)=>{assert.equal(p.function,'campaigns_list');assert.equal(p.campaign_id,'CAMP01');return 'campaign_id|active\nCAMP01|Y';}},'./vicidial-live':{startVicidialAgent:async agent=>{assert.ok(running);started.push(agent);}}});
 const response=await api.postCampaigns(request({action:'start',campaignId:id}),'admin'),body=await response.json();assert.equal(response.status,200);assert.deepEqual(started,['free']);assert.equal(body.confirmed,2);assert.equal(body.busyAgents,1);assert.deepEqual(body.failed,[]);
});
