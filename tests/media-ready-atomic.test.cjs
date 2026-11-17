const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
test('atomic media activation cannot answer a missing voice, ended call, or an already activated session',{skip:process.env.SHAHVEX_LIVE_TMP_DB_TEST!=='1'},async()=>{
 require('@next/env').loadEnvConfig(process.cwd(),false);
 const {Client}=require('pg'),client=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await client.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TEMP TABLE agent_calls(id text PRIMARY KEY,status text,voice_session_id text,conversation_state text,answered_at timestamptz,last_heartbeat_at timestamptz) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE vicidial_events(connection_id text,event_id text,payload_hash text,processing_state text,processed_at timestamptz,lease_expires_at timestamptz,response_payload jsonb,response_status int) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE ai_agent_runtime_states(call_id text PRIMARY KEY,state text,last_seen_at timestamptz,updated_at timestamptz) ON COMMIT DROP`);
  assert.equal((await client.query("SELECT relpersistence FROM pg_class WHERE oid='agent_calls'::regclass")).rows[0].relpersistence,'t');
  await client.query("INSERT INTO agent_calls(id,status,voice_session_id) VALUES('ready','INITIATED','voice'),('missing','INITIATED',NULL),('ended','COMPLETED','voice')");
  await client.query("INSERT INTO ai_agent_runtime_states(call_id,state) VALUES('ready','RESERVED'),('missing','RESERVED'),('ended','RESERVED')");
  const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.resolve('lib/agent-runtime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.equal(name,'./database');return {db:async()=>client};},m,m.exports);
  assert.equal(await m.exports.mediaReady('ready'),true);assert.equal(await m.exports.mediaReady('ready'),false);assert.equal(await m.exports.mediaReady('missing'),false);assert.equal(await m.exports.mediaReady('ended'),false);
  const rows=(await client.query('SELECT c.id,c.status,r.state FROM agent_calls c JOIN ai_agent_runtime_states r ON r.call_id=c.id ORDER BY c.id')).rows;
  await client.query("INSERT INTO vicidial_events VALUES('c','event','hash','RUNNING',NULL,NOW(),NULL,NULL)");
  assert.equal(await m.exports.mediaReady('missing','allocated-voice',{connectionId:'c',eventId:'event',payloadHash:'hash',payload:{mediaReady:true}}),true);
  const saved=(await client.query("SELECT processing_state,response_payload FROM vicidial_events WHERE event_id='event'")).rows[0];assert.equal(saved.processing_state,'COMPLETED');assert.deepEqual(saved.response_payload,{mediaReady:true});
  assert.equal((await client.query("SELECT voice_session_id FROM agent_calls WHERE id='missing'")).rows[0].voice_session_id,'allocated-voice');
  assert.deepEqual(rows,[{id:'ended',status:'COMPLETED',state:'RESERVED'},{id:'missing',status:'INITIATED',state:'RESERVED'},{id:'ready',status:'ANSWERED',state:'BUSY'}]);
 }finally{await client.query('ROLLBACK');await client.end();}
});
