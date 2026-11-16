const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='server-only'?{}:require(n),m,m.exports);return m.exports;}
test('manual remote control prevents background ACTIVE/INACTIVE API requests',async()=>{
 let native=0;const query=async sql=>{
  if(sql.startsWith('SELECT x.agent_id'))return {rows:[]};
  if(sql.startsWith('SELECT q.*'))return {rows:[{agent_id:'agent',remote_user:'9001',ready:true,runtime_state:'READY',connection_enabled:true,last_heartbeat_at:new Date(),intake_state:'RUNNING',campaign_enabled:true,assignment_enabled:true,line_state:'UNKNOWN',manage_remote_agents:false}]};
  if(sql.startsWith('SELECT a.status'))return {rows:[{status:'APPROVED',daily_call_limit:25,today:0}]};return {rows:[]};
 };
 const api=load('lib/vicidial-queue.ts',{'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial':{vicidialRequest:async()=>{native++;throw Error('Forbidden remote mutation')}},'./bpo-entitlements':{}});
 await api.reconcileVicidialQueues('connection');assert.equal(native,0);
});
test('manual remote control stops website queue without sending remote INACTIVE',async()=>{
 let native=0;const query=async sql=>({rows:sql.startsWith('SELECT q.remote_user')?[{remote_user:'9001',manage_remote_agents:false}]:[]});
 const api=load('lib/vicidial-live.ts',{'./database':{db:async()=>({query})},'./credential-crypto':{},'./vicidial':{vicidialRequest:async()=>{native++;throw Error('Forbidden remote mutation')}},'./vicidial-config':{},'./vicidial-bridge':{},'./vicidial-leads':{},'./agent-script-extraction':{},'./agent-test':{},'./agent-runtime':{},'./agent-script-details':{},'./campaign-config':{},'./bpo-entitlements':{}});
 await api.stopVicidialAgent('agent');assert.equal(native,0);
});

test('background resume excludes deleted and unapproved agents before attempting intake',async()=>{
 let resumeQuery='';const query=async sql=>{if(sql.startsWith('SELECT x.agent_id'))resumeQuery=sql;return{rows:[]};};
 const api=load('lib/vicidial-queue.ts',{'./database':{db:async()=>({query})},'./credential-crypto':{},'./vicidial':{},'./bpo-entitlements':{}});await api.reconcileVicidialQueues('connection');assert.match(resumeQuery,/JOIN agents a ON a.id=x.agent_id AND a.deleted_at IS NULL AND a.status='APPROVED'/);
});
