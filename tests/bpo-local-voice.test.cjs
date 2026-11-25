const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const campaignModule={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-campaign-assignment.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,campaignModule,campaignModule.exports);
function harness(allowed=true,hasVoip=true,native=false,deletion={}){const calls=[];const tx={release(){},async query(sql,p=[]){calls.push({sql,p});if(sql.startsWith('SELECT a.id,a.deleted_at'))return{rows:deletion.owned?[{id:p[0],deleted_at:deletion.deletedAt}]:[]};if(sql.startsWith('SELECT 1 FROM agent_calls'))return{rowCount:Number(Boolean(deletion.active)),rows:[]};if(sql.startsWith('SELECT id FROM agents WHERE id='))return{rows:[{id:'bpo'}]};if(sql.startsWith('SELECT id,live_config FROM voip_connections'))return{rows:hasVoip?[{id:'voip',live_config:{enabled:native}}]:[]};if(sql.startsWith('SELECT NULL::text id,name script_file_name'))return {rows:[{id:null,script_file_name:'Mapped campaign',script_text:'Assigned campaign goal'}]};if(sql.startsWith('SELECT * FROM campaign_definitions'))return {rows:[{id:p[0],connection_id:'123e4567-e89b-42d3-a456-426614174002',external_campaign_id:'CAMPAIGN'}]};if(sql.startsWith('SELECT COUNT'))return{rows:[{agents:0}]};if(sql.startsWith('SELECT v.id')){assert.match(sql,/is_global=TRUE OR owner_id=\$1/);return{rows:allowed?[{id:'local-adam',name:'Adam',accent:'American English',is_local:true}]:[]};}if(sql.startsWith('SELECT id,script_file_name'))return{rows:[{id:'script',script_file_name:'script.txt',script_text:'Assigned goal'}]};if(sql.startsWith('SELECT id,lead_file_name'))return{rows:[{id:'lead',lead_file_name:'leads.csv'}]};return{rows:[]};}};const mod={exports:{}};const deps={'@/lib/vicidial-live':{stopVicidialAgent:async id=>calls.push({sql:'stopVicidialAgent',p:[id]})},'@/lib/request-origin':{isSameRequestOrigin:()=>true},'@/lib/voip-controller':{agentRouteFields:require('zod').z.object({})},'@/lib/bpo-agent-profile':{},'@/lib/agent-script-details':{conversationStyles:['Professional','Friendly']},'@/lib/agent-campaign-assignment':campaignModule.exports,'@/lib/agent-test':{localVoices:async()=>({voices:[]})},'@/lib/database':{db:async()=>({connect:async()=>tx})},'@/lib/bpo-session':{requireApprovedBpo:async()=>({agentId:'bpo'})},'@/lib/bpo-entitlements':{bpoEntitlements:async()=>({agents:2})},bcryptjs:{hash:async()=> 'fixture-hash'}};const code=ts.transpileModule(fs.readFileSync('app/api/bpo/agents/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>deps[n]||require(n),mod,mod.exports);return{POST:mod.exports.POST,DELETE:mod.exports.DELETE,calls};}
const request=()=>new Request('http://localhost:3000/api/bpo/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Fixture Agent',gender:'MALE',voiceId:'local-adam',connectionId:'123e4567-e89b-42d3-a456-426614174002',campaignId:'CAMPAIGN',scriptId:'123e4567-e89b-42d3-a456-426614174000',leadSheetId:'123e4567-e89b-42d3-a456-426614174001',dialingMode:'BOTH'})});
test('BPO creation saves local voice directly without a cloud credential or voice-assignment record',async()=>{const h=harness();assert.equal((await h.POST(request())).status,201);const update=h.calls.find(x=>x.sql.startsWith('UPDATE agents SET local_voice_id'));assert.equal(update.p[0],'local-adam');const insert=h.calls.find(x=>x.sql.startsWith('INSERT INTO bpo_created_agents'));assert.equal(insert.p[2],null);assert.equal(h.calls.some(x=>x.sql.startsWith('INSERT INTO agent_credentials')),false);});
test('BPO creation rejects unavailable or other-tenant voices',async()=>{const h=harness(false);assert.equal((await h.POST(request())).status,403);assert.ok(h.calls.some(x=>x.sql==='ROLLBACK'));assert.equal(h.calls.some(x=>x.sql.startsWith('INSERT INTO agents')),false);});

test('BPO creation is blocked before inserting an agent when VoIP is missing or belongs to another tenant',async()=>{const h=harness(true,false);assert.equal((await h.POST(request())).status,400);assert.equal(h.calls.some(x=>x.sql.startsWith('INSERT INTO agents')),false);const q=h.calls.find(x=>x.sql.startsWith('SELECT id,live_config FROM voip_connections'));assert.match(q.sql,/owner_id=\$2 AND enabled=TRUE/);assert.equal(q.p[1],'bpo');});

test('VICIdial campaign agent creation requires no customer sheet and copies no numbers',async()=>{
 const h=harness(true,true,true),body=await request().json();delete body.leadSheetId;
 const r=await h.POST(new Request('http://localhost:3000/api/bpo/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(r.status,201);
 assert.equal(h.calls.some(x=>x.sql.startsWith('SELECT id,lead_file_name')),false);
 const assignment=h.calls.find(x=>x.sql.startsWith('INSERT INTO script_assignments'));
 assert.equal(assignment.p[2],'');assert.equal(assignment.p[8],'[]');assert.equal(assignment.p[9],'[]');
});

test('mapped campaign creation uses its saved script without a library upload or number sheet',async()=>{
 const h=harness(true,true,true),body=await request().json();delete body.scriptId;delete body.leadSheetId;body.campaignDefinitionId='123e4567-e89b-42d3-a456-426614174003';
 const r=await h.POST(new Request('http://localhost:3000/api/bpo/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(r.status,201);assert.equal(h.calls.some(x=>x.sql.startsWith('SELECT id,script_file_name')),false);assert.equal(h.calls.some(x=>x.sql.startsWith('SELECT id,lead_file_name')),false);
 assert.equal(h.calls.find(x=>x.sql.startsWith('INSERT INTO script_assignments')).p[10],'Assigned campaign goal');
 const mapping=h.calls.find(x=>x.sql.startsWith('INSERT INTO campaign_agent_assignments'));assert.equal(mapping.p[1],body.campaignDefinitionId);assert.equal(mapping.p[2],'bpo');
});

test('BPO delete checks ownership and calls before archiving the agent and preserving history', async () => {
  const agentId = '123e4567-e89b-42d3-a456-426614174001';
  const remove = h => h.DELETE(new Request('http://localhost:3000/api/bpo/agents', {
    method: 'DELETE', headers: { origin: 'http://localhost:3000' }, body: JSON.stringify({ agentId }),
  }));
  const otherTenant = harness();
  assert.equal((await remove(otherTenant)).status, 404);
  assert.deepEqual(otherTenant.calls.find(entry => entry.sql.startsWith('SELECT a.id,a.deleted_at')).p, [agentId, 'bpo']);
  const active = harness(true, true, false, { owned: true, active: true });
  assert.equal((await remove(active)).status, 409);
  assert.equal(active.calls.some(entry => entry.sql === 'stopVicidialAgent'), false);
  const idle = harness(true, true, false, { owned: true });
  assert.equal((await remove(idle)).status, 200);
  assert.ok(idle.calls.some(entry => entry.sql === 'stopVicidialAgent'));
  assert.ok(idle.calls.some(entry => entry.sql.startsWith('UPDATE agents SET deleted_at=')));
  assert.equal(idle.calls.some(entry => /^DELETE FROM (agents|agent_calls) /i.test(entry.sql)), false);
  assert.equal(idle.calls.at(-1).sql, 'COMMIT');
});
