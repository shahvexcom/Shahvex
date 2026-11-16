const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path'),{createRequire}=require('node:module');
function load(file,deps={}){const filename=path.resolve(file),req=createRequire(filename),m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>Object.hasOwn(deps,n)?deps[n]:n==='@/lib/request-origin'?load('lib/request-origin.ts'):req(n),m,m.exports);return m.exports;}
function harness({role='ADMIN',found=['a','b'],active=[]}={}){const queries=[],stopped=[];const tx={release(){},async query(sql,args=[]){queries.push({sql,args});if(sql.startsWith('SELECT a.id FROM agents'))return {rows:found.map(id=>({id}))};if(sql.startsWith('SELECT agent_id FROM agent_calls'))return {rows:active.map(agent_id=>({agent_id}))};return {rows:[],rowCount:1};}};
 const api=load('app/api/admin/agents/route.ts',{'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'@/lib/session':{readSession:async()=>({role,agentId:'admin'})},'@/lib/database':{db:async()=>({connect:async()=>tx})},'@/lib/campaign-config':{campaignSettings:require('zod').z.object({})},'@/lib/agent-campaign-assignment':{},'@/lib/vicidial-live':{stopVicidialAgent:async id=>stopped.push(id)},'@/lib/agent-test':{},'@/lib/agent-script-details':{conversationStyles:['Professional']}});return{...api,queries,stopped};}
const request=(ids,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/admin/agents',{method:'DELETE',headers:{origin,'content-type':'application/json'},body:JSON.stringify({ids})});
test('single and selected bulk removal touches only selected agents and retains call records',async()=>{
 for(const ids of [['a'],['a','b']]){const h=harness({found:ids});const response=await h.DELETE(request(ids));assert.equal(response.status,200);assert.deepEqual((await response.json()).deletedIds,ids);assert.deepEqual(h.stopped,ids);
 const mutation=h.queries.find(q=>q.sql.startsWith('UPDATE agents SET deleted_at'));assert.deepEqual(mutation.args,[ids]);assert.ok(h.queries.some(q=>q.sql==='COMMIT'));assert.ok(!h.queries.some(q=>/DELETE FROM (agents|agent_calls|leads)/i.test(q.sql)));assert.match(h.queries.find(q=>q.sql.startsWith('SELECT a.id')).sql,/role='AGENT'.*bpo_created_agents/);}
});
test('active calls block the entire selected deletion before disabling any agent',async()=>{const h=harness({active:['b']});assert.equal((await h.DELETE(request(['a','b']))).status,409);assert.deepEqual(h.stopped,[]);assert.ok(h.queries.some(q=>q.sql==='ROLLBACK'));assert.ok(!h.queries.some(q=>q.sql.startsWith('UPDATE agents')));});
test('unauthorized, foreign-origin, empty and unavailable selections cannot mutate agents',async()=>{
 const unauthorized=harness({role:'AGENT'});assert.equal((await unauthorized.DELETE(request(['a']))).status,401);assert.equal(unauthorized.queries.length,0);
 const foreign=harness();assert.equal((await foreign.DELETE(request(['a'],'https://foreign.example'))).status,403);assert.equal(foreign.queries.length,0);
 assert.equal((await harness().DELETE(request([]))).status,400);
 const missing=harness({found:['a']});assert.equal((await missing.DELETE(request(['a','b']))).status,404);assert.deepEqual(missing.stopped,[]);
});
test('Live calls rejects schedule writes and old auto-schedule polls start nothing',async()=>{
 let starts=0,queries=0;
 const api=load('app/api/admin/calls/route.ts',{'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'@/lib/session':{readSession:async()=>({role:'ADMIN'})},'@/lib/database':{db:async()=>({query:async()=>{queries++;return {rows:[]}}})},'@/lib/call-start':{startAgentCall:async()=>{starts++;}},'@/lib/credential-crypto':{}});
 for(const [action,expected]of [['run-schedules',200],['save-schedule',410]]){
  const response=await api.POST(new Request('http://localhost/api/admin/calls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,agentId:'a',isEnabled:true,startTime:'09:00',endTime:'17:00'})}));assert.equal(response.status,expected);
 }
 assert.equal(starts,0);assert.equal(queries,0);
});
