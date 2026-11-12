const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function load(file,deps={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:require(n),m,m.exports);return m.exports;}
const details=load('lib/agent-script-details.ts');
test('create without a script; edit preserves Scripts-page assignment while saving voice and style',async()=>{
 let saved,voiceCalls=0; const campaignConfig=load('lib/campaign-config.ts');const voice={id:'dynamic-voice',name:'Dynamic',gender:'male',accent:'Irish English',language:'English'};
 const pool={query:async(sql,p=[])=>{
  if(sql.startsWith('WITH created')){assert.match(sql,/local_voice_id,agent_script,conversation_style,speaks_first,language/);assert.match(sql,/owner_id,verified/);saved={id:'agent-new',name:p[1],username:p[2],gender:p[4],accent:p[5],local_voice_id:p[12],agent_script:p[13],conversation_style:p[14],speaks_first:p[15],language:'English'};return{rows:[{id:saved.id}]};}
  if(sql.startsWith('SELECT password_hash'))return{rows:[{password_hash:'existing-hash'}]};
  if(sql.startsWith('UPDATE agents a SET name=')){saved={...saved,name:p[0],gender:p[2],accent:p[3],local_voice_id:p[10],agent_script:p[11]??saved.agent_script,conversation_style:p[12],speaks_first:p[13],language:p[14]};return{rows:[saved]};}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('UPDATE agents SET company_name'))return {rows:[]};
  if(sql.startsWith('SELECT (SELECT d.name')||sql.startsWith('SELECT a.company_name')||sql.startsWith('SELECT a.id'))return{rows:[saved]};throw Error('Unexpected SQL');
 }};
 pool.connect=async()=>({...pool,release(){}});
 const route=load('app/api/admin/agents/route.ts',{'@/lib/campaign-config':campaignConfig,'@/lib/agent-campaign-assignment':{saveAgentCampaign:async()=>{}},'@/lib/vicidial-live':{stopVicidialAgent:async()=>{}},'next/headers':{cookies:async()=>({get:()=>({value:'test'})})},'@/lib/session':{readSession:async()=>({role:'ADMIN',agentId:'admin-owner'})},'@/lib/database':{db:async()=>pool},'@/lib/agent-script-details':details,'@/lib/agent-test':{localVoices:async owner=>{assert.equal(owner,'admin-owner');voiceCalls++;return{voices:[voice]};}}});
 const input={name:'Configured Agent',username:'configured.agent',password:'fixture-password',gender:'FEMALE',accent:'Wrong accent',avatar_url:'',status:'APPROVED',call_limit_minutes:0,daily_call_limit:25,local_voice_id:voice.id,conversation_style:'Consultative',speaks_first:'ai',language:'English'};
 const req=(body,method='POST')=>new Request('http://localhost/api/admin/agents',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const created=await route.POST(req(input));assert.equal(created.status,201);assert.equal(saved.local_voice_id,voice.id);assert.equal(saved.agent_script,'');assert.equal(saved.conversation_style,'Consultative');assert.equal(saved.speaks_first,'ai');assert.equal(saved.accent,voice.accent);assert.equal(saved.gender,'MALE');
 saved.agent_script='Assigned through Scripts';
 const updated=await route.PATCH(req({...input,id:saved.id,password:'',conversation_style:'Calm & Patient',speaks_first:'customer'},'PATCH'));assert.equal(updated.status,200);assert.equal(saved.conversation_style,'Calm & Patient');assert.equal(saved.speaks_first,'customer');assert.equal(saved.agent_script,'Assigned through Scripts');assert.equal(voiceCalls,2);
 const invalid=await route.POST(req({...input,language:'Urdu'}));assert.equal(invalid.status,400);
});
test('voice references require matching ordered speech and registered metadata remains tenant-scoped',async()=>{
 const {referenceTranscriptMatches}=load('lib/voice-reference-validation.ts');assert.equal(referenceTranscriptMatches('Hello, this is my voice.','Hello this is my voice'),true);assert.equal(referenceTranscriptMatches('Please do not authorize payment.','Authorize payment please.'),false);assert.equal(referenceTranscriptMatches('Real words here',''),false);
 const queries=[];const connection={query:async sql=>{queries.push(sql);return{rows:[]};},release:()=>{}};
 const lib=load('lib/local-voice-registry.ts',{'server-only':{},'./database':{db:async()=>({connect:async()=>connection,query:async(sql,p)=>{assert.match(sql,/owner_id=\$1/);assert.equal(p[0],'tenant-a');return{rows:[{id:'approved',name:'Approved',language:'English',accent:'Australian English',gender:'female'}]};}})}});
 await assert.rejects(lib.registeredVoices('tenant-a',{defaultVoice:'',voices:[]}),/No selectable English/);
 const result=await lib.registeredVoices('tenant-a',{defaultVoice:'approved',voices:[{id:'approved',name:'Backend name',gender:'female',language:'English',accent:'',selectable:true}]});assert.equal(result.voices[0].accent,'Australian English');assert.ok(queries.includes('COMMIT'));
});
test('retired Quick Dial cannot execute a real call from either portal',async()=>{
 const bpo=load('app/api/bpo/quick-dial/route.ts',{'next/headers':{},'@/lib/database':{},'@/lib/bpo-entitlements':{},'@/lib/bpo-session':{},'@/lib/session':{},'@/app/api/admin/credentials/route':{}});
 const admin=load('app/api/admin/quick-dial/route.ts',{'@/app/api/bpo/quick-dial/route':{GET:()=>assert.fail('retired'),POST:()=>assert.fail('retired')}});
 for(const route of [admin,bpo])for(const method of ['GET','POST'])assert.equal((await route[method](new Request('http://localhost/api/quick-dial',{method}))).status,410);
});
test('Scripts-page deletion refreshes the affected agent script from remaining assignments',async()=>{
 const writes=[];
 const route=load('app/api/admin/scripts/route.ts',{
  'next/headers':{cookies:async()=>({get:()=>({value:'test'})})},
  '@/lib/session':{readSession:async()=>({role:'ADMIN',agentId:'admin-owner'})},
  '@/lib/database':{db:async()=>({query:async(sql,p)=>{writes.push({sql,p});return{rows:sql.startsWith('DELETE')?[{id:'assignment',agent_id:'agent-a'}]:[]};}})},
 });
 const response=await route.DELETE(new Request('http://localhost/api/admin/scripts?id=assignment'));
 assert.equal(response.status,200);assert.equal(writes.length,2);assert.match(writes[1].sql,/agent_script=COALESCE\(\(SELECT script_text/);assert.deepEqual(writes[1].p,['agent-a']);
});
