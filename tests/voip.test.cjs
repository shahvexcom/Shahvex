const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const http=require('node:http');
function load(file,deps={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>Object.hasOwn(deps,n)?deps[n]:n==='./vicidial-config'?load('lib/vicidial-config.ts'):n==='./vicidial-bridge'?load('lib/vicidial-bridge.ts',{'server-only':{},'./vicidial':vici}):n==='./request-origin'?load('lib/request-origin.ts'):require(n),m,m.exports);return m.exports;}
const vici=load('lib/vicidial.ts',{'server-only':{}});
test('VICIdial destination validation and credential-aware verification reject false positives',()=>{
  assert.throws(()=>vici.vicidialURL('https://user:secret@dialer.example.com'));
  assert.throws(()=>vici.vicidialURL('http://dialer.example.com'));
  assert.equal(vici.vicidialURL('https://dialer.example.com').pathname,'/vicidial/non_agent_api.php');
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.1.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(vici.publicAddress(address),false,address);
  assert.equal(vici.publicAddress('8.8.8.8'),true);
  assert.equal(vici.verifyVicidialUser('VERSION: 2.14|BUILD: 123|','apiuser'),false);
  assert.equal(vici.verifyVicidialUser('user,full_name,user_group,user_level,active\napiuser,"Test, Admin",ADMIN,9,Y','apiuser'),true);
  assert.equal(vici.verifyVicidialUser('user,full_name,user_group,user_level,active\nother,Test,ADMIN,9,Y','apiuser'),false);
});
test('real HTTP fixture receives only read-only authenticated POST, never URL credentials or call actions',async()=>{
  const saved=process.env.SHAHVEX_VOIP_ALLOWED_HOSTS;process.env.SHAHVEX_VOIP_ALLOWED_HOSTS='127.0.0.1';let calls=0;
  const server=http.createServer(async(req,res)=>{calls++;assert.equal(req.url,'/vicidial/non_agent_api.php');assert.equal(req.method,'POST');let raw='';for await(const c of req)raw+=c;const body=new URLSearchParams(raw);assert.equal(body.get('function'),'user_details');assert.equal(body.get('pass'),'fixture-only-secret');assert.equal(body.get('agent_user'),'apiuser');res.end('user,full_name,user_group,user_level,active\napiuser,Fixture,ADMIN,9,Y');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const result=await vici.testVicidial(`http://127.0.0.1:${server.address().port}`,'apiuser','fixture-only-secret');assert.equal(result.status,'CONNECTED');assert.match(result.message,/media.*unverified/);assert.equal(calls,1);}finally{await new Promise(resolve=>server.close(resolve));if(saved===undefined)delete process.env.SHAHVEX_VOIP_ALLOWED_HOSTS;else process.env.SHAHVEX_VOIP_ALLOWED_HOSTS=saved;}
});
test('controller VoIP saves connection and multiple agent routes atomically and excludes BPO agents',async()=>{
 const saved=process.env.CREDENTIAL_ENCRYPTION_KEY;process.env.CREDENTIAL_ENCRYPTION_KEY='fixture-only-key-with-sufficient-test-entropy';
 const crypto=load('lib/credential-crypto.ts',{'server-only':{}});let invalid=false,fail=false;const calls=[];
 const tx={release(){calls.push('release')},async query(sql,p=[]){calls.push(sql);if(sql.startsWith('SELECT a.id')){assert.match(sql,/bpo_created_agents/);assert.match(sql,/tenant.role='BPO'/);return{rowCount:invalid?0:2,rows:[]};}if(sql.startsWith('INSERT INTO voip_connections')){assert.notEqual(p[5],'private-secret');return{rows:[{id:p[0],name:p[2]}]};}if(sql.startsWith('UPDATE voip_connections'))return{rows:[]};if(sql.startsWith('INSERT INTO voip_agent_assignments')&&fail)throw Error('fixture assignment failure');return{rows:[]};}};
 const pool={connect:async()=>tx,query:async sql=>{if(sql.startsWith('SELECT q.agent_id'))return{rows:[]};if(sql.startsWith('SELECT id,admin_role'))return{rows:[{admin_role:'SUPER_ADMIN'}]};throw Error('Unexpected query')}};
 const controller=load('lib/voip-controller.ts',{'server-only':{},'next/headers':{cookies:async()=>({get:()=>({value:'test'})})},'./session':{ADMIN_SESSION_COOKIE:'admin',BPO_SESSION_COOKIE:'bpo',readSession:async()=>({role:'ADMIN',agentId:'admin-a'})},'./database':{db:async()=>pool},'./credential-crypto':crypto,'./vicidial':vici});
 const body={action:'save-assigned',name:'Dialer',serverUrl:'https://dialer.example.com',username:'apiuser',secret:'private-secret',method:'NON_AGENT_API',enabled:true,agentIds:['agent-a','agent-b'],direction:'OUTBOUND',campaignId:'DEMO',inboundDid:'',inGroup:'',routingDestination:''};
 const req=(value=body)=>new Request('http://localhost:3000/api/admin/voip',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  const created=await controller.postVoip(req(),'admin');assert.equal(created.status,201);assert.equal((await created.text()).includes('private-secret'),false);assert.equal(calls.filter(s=>s.startsWith('INSERT INTO voip_agent_assignments')).length,2);assert.ok(calls.includes('COMMIT'));
  calls.length=0;invalid=true;assert.equal((await controller.postVoip(req(),'admin')).status,400);assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.some(s=>s.startsWith('INSERT INTO voip_connections')),false);
  invalid=false;fail=true;calls.length=0;assert.equal((await controller.postVoip(req(),'admin')).status,503);assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.includes('COMMIT'),false);
  assert.equal((await controller.postVoip(req({...body,agentIds:[]}),'admin')).status,400);
  assert.equal((await controller.postVoip(req(),'bpo')).status,403);
  assert.equal((await controller.getVoip(new Request('http://localhost:3000/api/bpo/voip'),'bpo')).status,403);
  fail=false;calls.length=0;assert.equal((await controller.postVoip(req({...body,id:'other-admin-connection'}),'admin')).status,404);assert.ok(calls.includes('ROLLBACK'));
 }finally{if(saved===undefined)delete process.env.CREDENTIAL_ENCRYPTION_KEY;else process.env.CREDENTIAL_ENCRYPTION_KEY=saved;}
});
test('BPO VoIP lists only tenant-owned connections and BPO-created agents',async()=>{
 const client={query:async(sql,p=[])=>{if(sql.startsWith('SELECT id,admin_role'))return{rows:[{id:'bpo-a'}]};if(sql.startsWith('SELECT id,name,server_url')){assert.match(sql,/owner_id=\$1/);assert.equal(p[0],'bpo-a');return{rows:[{id:'own-connection'}]};}if(sql.startsWith('SELECT id,agent_id')){assert.match(sql,/owner_id=\$1/);return{rows:[]};}if(sql.startsWith('SELECT a.id')){assert.match(sql,/bpo_created_agents/);assert.match(sql,/b.bpo_id=\$1/);assert.equal(p[0],'bpo-a');return{rows:[{id:'own-agent'}]};}if(sql.startsWith('SELECT id,server_url'))return{rows:[]};throw Error('Unexpected SQL');}};
 const c=load('lib/voip-controller.ts',{'server-only':{},'next/headers':{cookies:async()=>({get:()=>({value:'test'})})},'./session':{ADMIN_SESSION_COOKIE:'admin',BPO_SESSION_COOKIE:'bpo',readSession:async()=>({role:'BPO',agentId:'bpo-a'})},'./database':{db:async()=>client},'./credential-crypto':{encryptCredential:()=>'',decryptCredential:()=>''},'./vicidial':vici});
 const result=await(await c.getVoip(new Request('http://localhost:3000/api/bpo/voip'),'bpo')).json();assert.equal(result.connections[0].id,'own-connection');assert.equal(result.agents[0].id,'own-agent');
 const denied=await c.postVoip(new Request('http://localhost:3000/api/bpo/voip',{method:'POST',headers:{origin:'http://localhost:3000'},body:JSON.stringify({action:'test',id:'other-tenant-connection'})}),'bpo');assert.equal(denied.status,404);
});
test('connection creation needs no agents and delete/disable stay owner scoped while retaining history',async()=>{
 const writes=[],previous=process.env.CREDENTIAL_ENCRYPTION_KEY;process.env.CREDENTIAL_ENCRYPTION_KEY='fixture-only-encryption';
 const client={query:async(sql,p=[])=>{writes.push({sql,p});if(sql.startsWith('SELECT id,admin_role'))return {rows:[{admin_role:'SUPER_ADMIN'}]};if(sql.startsWith('INSERT INTO voip_connections'))return {rows:[{id:'saved-connection'}]};if(sql.startsWith('SELECT id FROM voip_connections'))return {rows:p[0]==='saved-connection'?[{id:p[0]}]:[]};return {rows:[]};}};
 const c=load('lib/voip-controller.ts',{'server-only':{},'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'./session':{ADMIN_SESSION_COOKIE:'admin',readSession:async()=>({role:'ADMIN',agentId:'owner'})},'./database':{db:async()=>client},'./credential-crypto':{encryptCredential:()=> 'encrypted'},'./vicidial':vici});
 const request=value=>new Request('https://site.example.test/api/admin/voip',{method:'POST',headers:{origin:'https://site.example.test'},body:JSON.stringify(value)});
 try{
  const r=await c.postVoip(request({action:'save',name:'Saved connection',serverUrl:'https://dialer.example.test',username:'apiuser',secret:'fixture',method:'NON_AGENT_API',enabled:true}),'admin');assert.equal(r.status,201);assert.ok(!writes.some(w=>w.sql.includes('INSERT INTO voip_agent_assignments')));
  assert.equal((await c.postVoip(request({action:'disable',id:'foreign'}),'admin')).status,404);
  assert.equal((await c.postVoip(request({action:'disable',id:'saved-connection'}),'admin')).status,200);
  assert.equal((await c.postVoip(request({action:'delete',id:'saved-connection'}),'admin')).status,200);
  const archived=writes.find(w=>w.sql.startsWith('UPDATE voip_connections SET enabled=FALSE')&&w.p[2]===true);assert.ok(archived);assert.equal(archived.p[1],'owner');assert.ok(!writes.some(w=>/DELETE FROM (?:agent_calls|voip_connections)/.test(w.sql)));
 }finally{if(previous===undefined)delete process.env.CREDENTIAL_ENCRYPTION_KEY;else process.env.CREDENTIAL_ENCRYPTION_KEY=previous;}
});

test('VoIP counts and routes exclude deleted agents while keeping reserved routes visible',async()=>{
 const queries=[];const pool={query:async sql=>{queries.push(sql);if(sql.startsWith('SELECT id,admin_role'))return{rows:[{admin_role:'SUPER_ADMIN'}]};return{rows:[]};}};
 const c=load('lib/voip-controller.ts',{'server-only':{},'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'./session':{ADMIN_SESSION_COOKIE:'admin',readSession:async()=>({role:'ADMIN',agentId:'owner'})},'./database':{db:async()=>pool},'./credential-crypto':{},'./vicidial':vici});
 assert.equal((await c.getVoip(new Request('http://localhost/api/admin/voip'),'admin')).status,200);assert.match(queries.find(s=>s.includes('FROM voip_agent_assignments')),/a.deleted_at IS NULL/);assert.match(queries.find(s=>s.startsWith('SELECT a.id,a.name')),/a.deleted_at IS NULL/);assert.match(c.controllerAgentSQL,/a.deleted_at IS NULL/);
});

test('Test connection accepts actual browser Host when the internal Next URL uses 0.0.0.0',async()=>{
 let tests=0;const pool={query:async sql=>({rows:sql.startsWith('SELECT id,admin_role')?[{admin_role:'SUPER_ADMIN'}]:(sql.includes('FROM voip_connections')&&sql.startsWith('SELECT'))?[{id:'connection',enabled:true,server_url:'https://dialer.example.com',username:'api',secret_ciphertext:'encrypted'}]:[]})};
 const c=load('lib/voip-controller.ts',{'server-only':{},'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'./session':{ADMIN_SESSION_COOKIE:'admin',readSession:async()=>({role:'ADMIN',agentId:'owner'})},'./database':{db:async()=>pool},'./credential-crypto':{decryptCredential:()=> 'secret'},'./vicidial':{...vici,testVicidial:async()=>{tests++;return{status:'CONNECTED',message:'API verified'};},readVicidialVersion:async()=>({})}});
 const r=await c.postVoip(new Request('http://0.0.0.0:3000/api/admin/voip',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({action:'test',id:'connection'})}),'admin');assert.notEqual(r.status,403);assert.equal(tests,1);
});
