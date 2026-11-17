const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
test('atomic direct admission preserves mapping, duplicate-event, busy, pause and BPO boundaries',{skip:process.env.SHAHVEX_LIVE_TMP_DB_TEST!=='1'},async()=>{
 require('@next/env').loadEnvConfig(process.cwd(),false);const {Client}=require('pg');const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await db.connect();
 const m={exports:{}};new Function('exports',ts.transpileModule(fs.readFileSync('lib/vicidial-turn-admission.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports);
 try{
  await db.query('BEGIN');
  await db.query(`CREATE TEMP TABLE agents(id text PRIMARY KEY,name text,local_voice_id text,status text,deleted_at timestamptz,daily_call_limit int);
   CREATE TEMP TABLE bpo_created_agents(agent_id text);
   CREATE TEMP TABLE voip_connections(id text PRIMARY KEY,owner_id text,enabled boolean,bridge_secret_ciphertext text,media_verified_at timestamptz,live_config jsonb);
   CREATE TEMP TABLE campaign_definitions(id text PRIMARY KEY,connection_id text,owner_id text,external_campaign_id text,script text,enabled boolean,deleted_at timestamptz,intake_state text);
   CREATE TEMP TABLE campaign_agent_assignments(agent_id text,campaign_id text,enabled boolean);
   CREATE TEMP TABLE voip_agent_assignments(agent_id text,connection_id text,owner_id text,campaign_id text);
   CREATE TEMP TABLE vicidial_pool_agents(agent_id text,ready boolean,remote_user text,config jsonb,max_call_duration_seconds int);
   CREATE TEMP TABLE agent_calls(id text PRIMARY KEY,agent_id text,status text,telephony_provider text,voip_connection_id text,direct_audio_uuid text,direct_audio_line text,campaign_definition_id text,external_campaign_id text,script_snapshot jsonb,conversation_state text,dialing_source text,max_call_duration_seconds int,vicidial_sync_status text,voice_session_id text,created_at timestamptz DEFAULT NOW());
   CREATE TEMP TABLE ai_agent_runtime_states(agent_id text PRIMARY KEY,state text,call_id text UNIQUE REFERENCES agent_calls(id),campaign_id text,last_assigned_at timestamptz,last_seen_at timestamptz,lease_expires_at timestamptz,updated_at timestamptz);
   CREATE TEMP TABLE vicidial_events(connection_id text,event_id text,kind text,payload_hash text,processing_state text,lease_expires_at timestamptz,response_payload jsonb,response_status int,PRIMARY KEY(connection_id,event_id));`);
  for(const name of ['agents','agent_calls','voip_connections','ai_agent_runtime_states','vicidial_events'])assert.equal((await db.query('SELECT relpersistence FROM pg_class WHERE oid=$1::regclass',[name])).rows[0].relpersistence,'t');
  await db.query(`INSERT INTO agents VALUES('agent','Fixture','lissa','APPROVED',NULL,100);
   INSERT INTO voip_connections VALUES('connection','owner',true,'cipher',NOW(),'$JSON');
   INSERT INTO campaign_definitions VALUES('campaign','connection','owner','DIALER','Fixture script',true,NULL,'RUNNING');
   INSERT INTO campaign_agent_assignments VALUES('agent','campaign',true);
   INSERT INTO voip_agent_assignments VALUES('agent','connection','owner','DIALER');
   INSERT INTO vicidial_pool_agents VALUES('agent',true,'78601','{}',0);
   INSERT INTO ai_agent_runtime_states(agent_id,state) VALUES('agent','READY');`.replace('$JSON',JSON.stringify({enabled:true,directAudioMode:true,directAudioLines:[{agentId:'agent',remoteUser:'78601',prefix:'3531'}]})));
  const uuid=()=> '3531'+crypto.randomUUID().slice(4);
  const run=async({audio=uuid(),event=crypto.randomUUID(),hash='hash',remote='78601',cipher='cipher'}={})=>{const params=['connection',event,'direct-'+audio.replaceAll('-',''),hash,audio,'agent',remote,'owner',crypto.randomUUID(),'3531',cipher];return {row:(await db.query(m.exports.directAdmissionSql,params)).rows[0],params};};
  assert.equal((await db.query(m.exports.directPrefixReadSql,['connection','3531'])).rows[0].resolved_campaign_id,'DIALER');
  const first=await run();assert.equal(first.row.claimed,true);assert.equal(first.row.reservation_ok,1);assert.equal(first.row.admitted_call.direct_audio_uuid,first.params[4]);assert.equal((await db.query('SELECT state FROM ai_agent_runtime_states')).rows[0].state,'RESERVED');
  const duplicate=await run({audio:first.params[4],event:first.params[1]});assert.equal(duplicate.row.claimed,false);
  const existing=await run({audio:first.params[4]});assert.equal(existing.row.existing_call.id,first.row.admitted_call.id);assert.equal(existing.row.admitted_call,null);
  const busy=await run();assert.equal(busy.row.admitted_call,null);assert.equal((await db.query('SELECT COUNT(*)::int n FROM agent_calls')).rows[0].n,1);
  await db.query("UPDATE ai_agent_runtime_states SET call_id=NULL,state='READY';DELETE FROM agent_calls;UPDATE campaign_agent_assignments SET enabled=false");assert.equal((await run()).row.admitted_call,null);
  assert.equal((await db.query(m.exports.directPrefixReadSql,['connection','3531'])).rows[0].resolved_campaign_id,null);
  await db.query("UPDATE campaign_agent_assignments SET enabled=true;UPDATE agents SET daily_call_limit=0");assert.equal((await run()).row.admitted_call,null);
  await db.query('UPDATE agents SET daily_call_limit=100');assert.equal((await run({cipher:'stale'})).row.connection_current,false);assert.equal((await run({remote:'other'})).row.connection_current,false);
  await db.query("INSERT INTO bpo_created_agents VALUES('agent')");const bpo=await run();assert.equal(bpo.row.supported,false);assert.equal(bpo.row.claimed,false);
 }finally{await db.query('ROLLBACK');await db.end();}
});
