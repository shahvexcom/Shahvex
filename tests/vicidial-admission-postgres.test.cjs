const {test}=require('node:test'),assert=require('node:assert/strict');
test('PostgreSQL admission binds the call identity, returns a lean snapshot, and completes both records atomically',{skip:process.env.SHAHVEX_RUN_DB_TESTS!=='1'},async()=>{
 const fs=require('fs'),ts=require('typescript');require('@next/env').loadEnvConfig(process.cwd());const {Client}=require('pg');const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-turn-admission.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
 const {turnAdmissionSql:admit,turnCompletionSql:complete}=m.exports,c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000,query_timeout:20000});
 try{
  await c.connect();await c.query('BEGIN');
  await c.query("CREATE TEMP TABLE voip_connections(id TEXT,bridge_secret_ciphertext TEXT) ON COMMIT DROP");
  await c.query("CREATE TEMP TABLE vicidial_events(connection_id TEXT,event_id TEXT,call_id TEXT,kind TEXT,payload_hash TEXT,processing_state TEXT,lease_expires_at TIMESTAMPTZ,response_payload JSONB,response_status INT,processed_at TIMESTAMPTZ,last_error TEXT,PRIMARY KEY(connection_id,event_id)) ON COMMIT DROP");
  await c.query("CREATE TEMP TABLE agent_calls(id TEXT,voip_connection_id TEXT,direct_audio_uuid TEXT,telephony_provider TEXT,vicidial_call_id TEXT,status TEXT,transfer_status TEXT,conversation_busy BOOL,transfer_consent BOOL,handoff_ready BOOL,qualification JSONB,updated_at TIMESTAMPTZ,voice_session_id TEXT,conversation_history JSONB,conversation_state TEXT,transcript TEXT,script_snapshot JSONB) ON COMMIT DROP");
  await c.query("INSERT INTO voip_connections VALUES('connection','secret')");await c.query("INSERT INTO agent_calls(id,voip_connection_id,telephony_provider,vicidial_call_id,status,transfer_status,conversation_busy,voice_session_id,conversation_history,script_snapshot) VALUES('call','connection','VICIDIAL','native','ANSWERED','',FALSE,'session','[]','{\"script\":\"private snapshot\"}')");
  const request=(event,call='call',secret='secret')=>c.query(admit,['connection',event,call,'native','hash',null,secret]).then(r=>r.rows[0]);
  let r=await request('wrong','other');assert.equal(r.admitted_call,null);assert.equal((await c.query('SELECT conversation_busy FROM agent_calls')).rows[0].conversation_busy,false);
  r=await request('revoked','call','wrong');assert.equal(r.connection_current,false);assert.equal(r.claimed,false);
  r=await request('valid');assert.equal(r.admitted_call.id,'call');assert.equal(r.current_call,true);assert.ok(!Object.hasOwn(r.admitted_call,'script_snapshot'));assert.equal(r.prior,null);
  r=await request('valid');assert.equal(r.claimed,false);assert.equal(r.prior.processing_state,'RUNNING');
  await c.query(complete,['[{"role":"user","content":"Yes"}]','CLIENT: Yes','LISTENING','call','','connection','valid']);
  assert.equal((await c.query('SELECT conversation_busy FROM agent_calls')).rows[0].conversation_busy,false);assert.equal((await c.query("SELECT processing_state FROM vicidial_events WHERE event_id='valid'")).rows[0].processing_state,'COMPLETED');
 }finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
});
