module.exports=[41954,a=>{"use strict";let b=`
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS recording_serial BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_recording_serial_unique ON agent_calls(recording_serial);
`;a.s(["recordingSerialSchema",0,b])},65591,a=>{"use strict";let b=`
CREATE TABLE IF NOT EXISTS campaign_categories(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES agents(id),name VARCHAR(80) NOT NULL,
 description TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id,owner_id));
CREATE UNIQUE INDEX IF NOT EXISTS campaign_category_name_idx ON campaign_categories(owner_id,LOWER(name));
CREATE TABLE IF NOT EXISTS campaign_definitions(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES agents(id),category_id TEXT,name VARCHAR(100) NOT NULL,
 connection_id TEXT NOT NULL,external_campaign_id VARCHAR(80) NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,
 script TEXT NOT NULL DEFAULT '',settings JSONB NOT NULL DEFAULT '{}'::jsonb,transfer_in_group VARCHAR(80) NOT NULL DEFAULT '',
 intake_state TEXT NOT NULL DEFAULT 'STOPPED' CHECK(intake_state IN ('RUNNING','PAUSED','STOPPED')),
 native_active BOOLEAN,validated_at TIMESTAMPTZ,last_sync_at TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id,owner_id),UNIQUE(connection_id,external_campaign_id),
 FOREIGN KEY(category_id,owner_id) REFERENCES campaign_categories(id,owner_id),FOREIGN KEY(connection_id,owner_id) REFERENCES voip_connections(id,owner_id));
ALTER TABLE campaign_definitions ADD COLUMN IF NOT EXISTS script_extraction_hash TEXT NOT NULL DEFAULT '',ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS campaign_agent_assignments(
 agent_id TEXT PRIMARY KEY REFERENCES agents(id),campaign_id TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES agents(id),enabled BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),FOREIGN KEY(campaign_id,owner_id) REFERENCES campaign_definitions(id,owner_id));
CREATE TABLE IF NOT EXISTS agent_campaign_preferences(
 agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES agents(id),category_id TEXT REFERENCES campaign_categories(id) ON DELETE SET NULL,
 external_campaign_id VARCHAR(80) NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE agents ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT '',ADD COLUMN IF NOT EXISTS conversation_config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE voip_connections ADD COLUMN IF NOT EXISTS api_version TEXT NOT NULL DEFAULT '',ADD COLUMN IF NOT EXISTS asterisk_version TEXT NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS last_sync_error TEXT NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS last_human_event_at TIMESTAMPTZ;
ALTER TABLE vicidial_pool_agents ADD COLUMN IF NOT EXISTS line_state TEXT NOT NULL DEFAULT 'UNKNOWN',ADD COLUMN IF NOT EXISTS line_error TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS campaign_definition_id TEXT REFERENCES campaign_definitions(id),ADD COLUMN IF NOT EXISTS external_campaign_id TEXT,
 ADD COLUMN IF NOT EXISTS asterisk_uniqueid TEXT,ADD COLUMN IF NOT EXISTS asterisk_linkedid TEXT,
 ADD COLUMN IF NOT EXISTS ai_leg_released BOOLEAN NOT NULL DEFAULT FALSE,ADD COLUMN IF NOT EXISTS customer_ended BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS qualification JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS ai_agent_runtime_states(
 agent_id TEXT PRIMARY KEY REFERENCES agents(id),campaign_id TEXT REFERENCES campaign_definitions(id),call_id TEXT UNIQUE REFERENCES agent_calls(id),
 state TEXT NOT NULL DEFAULT 'OFFLINE' CHECK(state IN ('OFFLINE','READY','RESERVED','BUSY','TRANSFERRING','ERROR')),
 last_assigned_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ,lease_expires_at TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vicidial_sync_jobs(
 id TEXT PRIMARY KEY,call_id TEXT NOT NULL REFERENCES agent_calls(id),connection_id TEXT NOT NULL REFERENCES voip_connections(id),revision TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','RETRY','SUCCEEDED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 5,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_expires_at TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(call_id,revision));
CREATE TABLE IF NOT EXISTS ai_transfer_attempts(
 id TEXT PRIMARY KEY,call_id TEXT NOT NULL REFERENCES agent_calls(id),destination TEXT NOT NULL,state TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),error TEXT NOT NULL DEFAULT '');
ALTER TABLE vicidial_events ADD COLUMN IF NOT EXISTS processing_state TEXT NOT NULL DEFAULT 'PENDING',ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS response_payload JSONB,ADD COLUMN IF NOT EXISTS response_status INTEGER;
INSERT INTO ai_agent_runtime_states(agent_id,campaign_id,call_id,state)
 SELECT q.agent_id,x.campaign_id,a.id,CASE WHEN a.id IS NULL THEN 'OFFLINE' ELSE 'ERROR' END
 FROM vicidial_pool_agents q LEFT JOIN campaign_agent_assignments x ON x.agent_id=q.agent_id
 LEFT JOIN LATERAL(SELECT id FROM agent_calls ac WHERE ac.agent_id=q.agent_id AND ac.status IN ('INITIATED','RINGING','ANSWERED') ORDER BY ac.created_at DESC LIMIT 1) a ON TRUE
 ON CONFLICT(agent_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS ai_runtime_state_idx ON ai_agent_runtime_states(state,campaign_id);
CREATE INDEX IF NOT EXISTS sync_jobs_due_idx ON vicidial_sync_jobs(state,next_attempt_at);
`;async function c(a){await a.query(b)}async function d(a){await a.query(`CREATE TABLE IF NOT EXISTS live_monitor_settings (
    owner_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    initial_script TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await a.query(`ALTER TABLE live_monitor_settings ADD COLUMN IF NOT EXISTS local_url TEXT,
    ADD COLUMN IF NOT EXISTS local_secret_ciphertext TEXT`),await a.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS local_voice_id TEXT,
    ADD COLUMN IF NOT EXISTS agent_script TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS conversation_style TEXT NOT NULL DEFAULT 'Professional',
    ADD COLUMN IF NOT EXISTS speaks_first TEXT NOT NULL DEFAULT 'customer',
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English'`),await a.query("CREATE TABLE IF NOT EXISTS local_voice_bootstrap(id TEXT PRIMARY KEY)"),await a.query(`CREATE TABLE IF NOT EXISTS local_voice_registry(
    id TEXT PRIMARY KEY,name VARCHAR(80) NOT NULL,gender TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'English',accent VARCHAR(100) NOT NULL DEFAULT '',
    owner_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,is_global BOOLEAN NOT NULL DEFAULT FALSE,
    reference_path TEXT,reference_transcript TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'PENDING',
    rights_verified BOOLEAN NOT NULL DEFAULT FALSE,transcript_verified BOOLEAN NOT NULL DEFAULT FALSE,service_trusted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await a.query(`CREATE TABLE IF NOT EXISTS admin_agent_owners (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await a.query("ALTER TABLE admin_agent_owners ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE"),await a.query(`CREATE TABLE IF NOT EXISTS voip_connections (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL, server_url TEXT NOT NULL, username VARCHAR(80) NOT NULL,
    secret_ciphertext TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'NON_AGENT_API', enabled BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'NOT_TESTED', last_tested_at TIMESTAMPTZ, status_message TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(id,owner_id)
  )`),await a.query(`CREATE TABLE IF NOT EXISTS voip_agent_assignments (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, connection_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')), campaign_id VARCHAR(80) NOT NULL DEFAULT '',
    inbound_did VARCHAR(80) NOT NULL DEFAULT '', in_group VARCHAR(80) NOT NULL DEFAULT '', routing_destination VARCHAR(160) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(owner_id,agent_id),
    FOREIGN KEY(connection_id,owner_id) REFERENCES voip_connections(id,owner_id) ON DELETE RESTRICT
  )`),await a.query("CREATE INDEX IF NOT EXISTS voip_connections_owner_idx ON voip_connections(owner_id)"),await a.query("CREATE INDEX IF NOT EXISTS admin_agent_owners_owner_idx ON admin_agent_owners(owner_id)"),await a.query(`ALTER TABLE voip_connections ADD COLUMN IF NOT EXISTS live_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS bridge_secret_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS recording_secret_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS media_verified_at TIMESTAMPTZ`),await a.query("ALTER TABLE voip_connections ADD COLUMN IF NOT EXISTS manage_remote_agents BOOLEAN NOT NULL DEFAULT TRUE"),await a.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS direct_audio_uuid TEXT, ADD COLUMN IF NOT EXISTS direct_audio_line TEXT"),await a.query(`ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telephony_provider TEXT NOT NULL DEFAULT 'TELNYX',
    ADD COLUMN IF NOT EXISTS voip_connection_id TEXT REFERENCES voip_connections(id),
    ADD COLUMN IF NOT EXISTS vicidial_call_id TEXT, ADD COLUMN IF NOT EXISTS vicidial_lead_id TEXT,
    ADD COLUMN IF NOT EXISTS vicidial_agent_user TEXT, ADD COLUMN IF NOT EXISTS voice_session_id TEXT,
    ADD COLUMN IF NOT EXISTS script_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS collected_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS vicidial_sync_status TEXT NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS transfer_consent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS handoff_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ai_media_ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_recording_id TEXT,
    ADD COLUMN IF NOT EXISTS vicidial_recording_url TEXT NOT NULL DEFAULT ''`),await a.query(`CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_vicidial_id_idx
    ON agent_calls(voip_connection_id,vicidial_call_id) WHERE vicidial_call_id IS NOT NULL`),await a.query("CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_direct_audio_uuid ON agent_calls(voip_connection_id,direct_audio_uuid) WHERE direct_audio_uuid IS NOT NULL"),await a.query(`CREATE TABLE IF NOT EXISTS vicidial_pools (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES voip_connections(id),
    owner_id TEXT NOT NULL REFERENCES agents(id), campaign_id TEXT NOT NULL, list_id TEXT NOT NULL,
    sheet_hash TEXT NOT NULL, script_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id,campaign_id,list_id,sheet_hash,script_hash)
  )`),await a.query(`CREATE TABLE IF NOT EXISTS vicidial_pool_agents (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    pool_id TEXT NOT NULL REFERENCES vicidial_pools(id), remote_user TEXT NOT NULL,
    ready BOOLEAN NOT NULL DEFAULT FALSE, config JSONB NOT NULL, dialing_source TEXT NOT NULL DEFAULT 'DIRECT',
    max_call_duration_seconds INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await a.query(`CREATE UNIQUE INDEX IF NOT EXISTS vicidial_pool_remote_user_idx
    ON vicidial_pool_agents(pool_id,remote_user)`),await a.query(`CREATE TABLE IF NOT EXISTS vicidial_lead_sync (
    connection_id TEXT NOT NULL REFERENCES voip_connections(id), list_id TEXT NOT NULL, phone_number TEXT NOT NULL,
    pool_id TEXT NOT NULL REFERENCES vicidial_pools(id), vendor_code TEXT NOT NULL,
    external_lead_id TEXT, state TEXT NOT NULL DEFAULT 'PENDING', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(connection_id,list_id,phone_number)
  )`),await a.query(`CREATE TABLE IF NOT EXISTS vicidial_events (
    connection_id TEXT NOT NULL REFERENCES voip_connections(id), event_id TEXT NOT NULL,
    call_id TEXT, kind TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(connection_id,event_id)
  )`),await c(a)}a.s(["ensureVoipSchema",0,d],65591)},6509,a=>a.a(async(b,c)=>{try{var d=a.i(23862),e=a.i(41954),f=a.i(65591),g=b([d]);[d]=g.then?(await g)():g;let j=globalThis,k=function(){let a=[process.env.DATABASE_URL,process.env.DIRECT_URL].find(a=>a?.trim());if(!a)throw Error("Database is not configured. Set a non-empty DATABASE_URL or DIRECT_URL, then restart the Next.js server.");return a.trim().replace(/([?&])sslmode=require(?=&|$)/i,"$1sslmode=verify-full")}(),l=j.pool??new d.Pool({connectionString:k,ssl:{rejectUnauthorized:!1},connectionTimeoutMillis:1e4});async function h(){try{await l.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      username VARCHAR(30) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      gender VARCHAR(10) NOT NULL,
      accent VARCHAR(80) NOT NULL,
      avatar_url TEXT,
      status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
      role VARCHAR(10) NOT NULL DEFAULT 'AGENT',
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      message TEXT NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'INBOX',
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT ''"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS call_limit_minutes INTEGER"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_call_limit INTEGER NOT NULL DEFAULT 25"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email VARCHAR(254)"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone VARCHAR(40)"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(64)"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS admin_role VARCHAR(80) NOT NULL DEFAULT 'SUB_ADMIN'"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS admin_permissions JSONB NOT NULL DEFAULT '[]'::jsonb"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_secret TEXT"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS overall_credits NUMERIC(14,2) NOT NULL DEFAULT 0"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS remaining_credits NUMERIC(14,2) NOT NULL DEFAULT 0"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ"),await l.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS block_reason TEXT NOT NULL DEFAULT ''"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_credit_contact_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    whatsapp_url TEXT NOT NULL,
    instagram_url TEXT NOT NULL,
    messenger_url TEXT NOT NULL,
    updated_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`INSERT INTO bpo_credit_contact_settings (id,whatsapp_url,instagram_url,messenger_url)
     VALUES (1,$1,$2,$3) ON CONFLICT (id) DO NOTHING`,["https://wa.me/","https://instagram.com/","https://m.me/"]),await l.query(`CREATE TABLE IF NOT EXISTS bpo_credit_transactions (
    id TEXT PRIMARY KEY,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    loaded_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("CREATE INDEX IF NOT EXISTS bpo_credit_transactions_bpo_id_idx ON bpo_credit_transactions(bpo_id, created_at DESC)"),await l.query("ALTER TABLE bpo_credit_transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(12) NOT NULL DEFAULT 'LOAD'"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_usage_pricing (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
    agent_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (agent_unit_price >= 0),
    call_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (call_unit_price >= 0),
    minute_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (minute_unit_price >= 0),
    recording_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (recording_unit_price >= 0),
    storage_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (storage_unit_price >= 0),
    storage_unit VARCHAR(2) NOT NULL DEFAULT 'GB' CHECK (storage_unit IN ('MB','GB')),
    updated_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE bpo_usage_pricing ADD COLUMN IF NOT EXISTS storage_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (storage_unit_price >= 0), ADD COLUMN IF NOT EXISTS storage_unit VARCHAR(2) NOT NULL DEFAULT 'GB' CHECK (storage_unit IN ('MB','GB'))"),await l.query("INSERT INTO bpo_usage_pricing (id) VALUES (1) ON CONFLICT (id) DO NOTHING"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_usage_addon_purchases (
    id TEXT PRIMARY KEY,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    product_type VARCHAR(12) NOT NULL CHECK (product_type IN ('AGENT','CALL','MINUTE','RECORDING','STORAGE')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(14,2) NOT NULL CHECK (total_price >= 0),
    storage_unit VARCHAR(2) CHECK (storage_unit IN ('MB','GB')),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE bpo_usage_addon_purchases ADD COLUMN IF NOT EXISTS storage_unit VARCHAR(2) CHECK (storage_unit IN ('MB','GB'))"),await l.query("ALTER TABLE bpo_usage_addon_purchases DROP CONSTRAINT IF EXISTS bpo_usage_addon_purchases_product_type_check"),await l.query("ALTER TABLE bpo_usage_addon_purchases ADD CONSTRAINT bpo_usage_addon_purchases_product_type_check CHECK (product_type IN ('AGENT','CALL','MINUTE','RECORDING','STORAGE'))"),await l.query("CREATE INDEX IF NOT EXISTS bpo_usage_addon_purchases_bpo_id_idx ON bpo_usage_addon_purchases(bpo_id,purchased_at DESC)"),await l.query(`CREATE TABLE IF NOT EXISTS agent_calls (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(e.recordingSerialSchema),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telnyx_call_control_id TEXT, ADD COLUMN IF NOT EXISTS telnyx_call_session_id TEXT, ADD COLUMN IF NOT EXISTS telnyx_connection_id TEXT, ADD COLUMN IF NOT EXISTS lead_name TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS lead_number VARCHAR(40) NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS recording_url TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS recording_id TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS recording_size_bytes BIGINT NOT NULL DEFAULT 0"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS conversation_busy BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS conversation_state VARCHAR(30) NOT NULL DEFAULT 'INITIALIZING', ADD COLUMN IF NOT EXISTS current_response_id TEXT, ADD COLUMN IF NOT EXISTS failure_reason TEXT NOT NULL DEFAULT ''"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telnyx_ai_conversation_id TEXT"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS recording_active BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS on_hold BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS start_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS mid_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS final_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS ending_requested BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS quick_dial_minute_rate NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_recording_rate NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_charge NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_settled BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS call_type VARCHAR(20) NOT NULL DEFAULT 'LEAD'"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS silence_prompt_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS interruption_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS misunderstanding_count INTEGER NOT NULL DEFAULT 0"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS pending_client_text TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS pending_client_at TIMESTAMPTZ"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS dialing_source VARCHAR(12) NOT NULL DEFAULT 'DIRECT' CHECK (dialing_source IN ('DIRECT','MANUAL','AUTO'))"),await l.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS max_call_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_call_duration_seconds >= 0)"),await l.query("UPDATE agent_calls SET call_type='QUICK_DIAL' WHERE lead_name='Quick dial' AND call_type='LEAD'"),await l.query("CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_telnyx_call_control_id_idx ON agent_calls(telnyx_call_control_id) WHERE telnyx_call_control_id IS NOT NULL"),await l.query("CREATE INDEX IF NOT EXISTS agent_calls_quick_dial_lookup_idx ON agent_calls(agent_id, call_type, created_at DESC)"),await l.query(`CREATE TABLE IF NOT EXISTS lead_claims (
    lead_number VARCHAR(40) PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    call_id TEXT,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("INSERT INTO lead_claims (lead_number,agent_id,call_id) SELECT lead_number,agent_id,id FROM agent_calls WHERE lead_number<>'' ON CONFLICT (lead_number) DO NOTHING"),await l.query(`UPDATE lead_claims lc SET call_id=c.id,agent_id=c.agent_id
    FROM (SELECT DISTINCT ON (lead_number) id,agent_id,lead_number FROM agent_calls WHERE lead_number<>'' ORDER BY lead_number,created_at ASC) c
    WHERE lc.lead_number=c.lead_number AND lc.call_id IS NULL`),await l.query("DELETE FROM lead_claims WHERE call_id IS NULL AND claimed_at < NOW() - INTERVAL '10 minutes'"),await l.query("CREATE TABLE IF NOT EXISTS telnyx_webhook_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"),await l.query(`CREATE TABLE IF NOT EXISTS do_not_call (
    phone_number VARCHAR(40) PRIMARY KEY,
    source_call_id TEXT,
    reason TEXT NOT NULL DEFAULT 'Customer opt-out',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'NEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS admin_roles (
    id TEXT PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS admin_preferences (
    admin_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    interface_sounds_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    background_sound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS ai_credentials (
    id TEXT PRIMARY KEY,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('GROQ', 'TELNYX')),
    label VARCHAR(80) NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    updated_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("CREATE INDEX IF NOT EXISTS ai_credentials_provider_idx ON ai_credentials(provider)"),await l.query(`CREATE TABLE IF NOT EXISTS admin_voices (
    id TEXT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    gender VARCHAR(10) NOT NULL DEFAULT 'OTHER',
    accent VARCHAR(80) NOT NULL DEFAULT 'Professional',
    telnyx_credential_id TEXT REFERENCES ai_credentials(id) ON DELETE RESTRICT,
    groq_credential_id TEXT REFERENCES ai_credentials(id) ON DELETE RESTRICT,
    status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (telnyx_credential_id IS NOT NULL OR groq_credential_id IS NOT NULL)
  )`),await l.query(`CREATE TABLE IF NOT EXISTS bpo_voice_assignments (
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    voice_id TEXT NOT NULL REFERENCES admin_voices(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bpo_id, voice_id)
  )`),await l.query("ALTER TABLE bpo_voice_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("CREATE INDEX IF NOT EXISTS bpo_voice_assignments_voice_id_idx ON bpo_voice_assignments(voice_id)"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_voice_preferences (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    auto_voice_id TEXT REFERENCES admin_voices(id) ON DELETE SET NULL,
    manual_voice_id TEXT REFERENCES admin_voices(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS bpo_plans (
    id TEXT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
    plan_badge VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM')),
    plan_kind VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (plan_kind IN ('STANDARD','CUSTOM')),
    assigned_bpo_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_limit INTEGER NOT NULL DEFAULT 0 CHECK (agent_limit >= 0),
    call_limit INTEGER NOT NULL DEFAULT 0 CHECK (call_limit >= 0),
    total_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_minutes >= 0),
    storage_amount NUMERIC(14,2) NOT NULL CHECK (storage_amount > 0),
    storage_unit VARCHAR(2) NOT NULL CHECK (storage_unit IN ('MB','GB')),
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS total_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_minutes >= 0)"),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS agent_limit INTEGER NOT NULL DEFAULT 0 CHECK (agent_limit >= 0)"),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT FALSE"),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS plan_badge VARCHAR(12) NOT NULL DEFAULT 'STANDARD'"),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS plan_kind VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (plan_kind IN ('STANDARD','CUSTOM'))"),await l.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS assigned_bpo_id TEXT REFERENCES agents(id) ON DELETE CASCADE"),await l.query("ALTER TABLE bpo_plans DROP CONSTRAINT IF EXISTS bpo_plans_plan_badge_check"),await l.query("ALTER TABLE bpo_plans ADD CONSTRAINT bpo_plans_plan_badge_check CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM'))"),await l.query("UPDATE bpo_plans SET plan_badge='RECOMMENDED' WHERE is_recommended=TRUE AND plan_badge='STANDARD'"),await l.query("CREATE INDEX IF NOT EXISTS bpo_plans_updated_at_idx ON bpo_plans(updated_at DESC)"),await l.query("CREATE INDEX IF NOT EXISTS bpo_plans_assigned_bpo_id_idx ON bpo_plans(assigned_bpo_id) WHERE assigned_bpo_id IS NOT NULL"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_plan_purchases (
    id TEXT PRIMARY KEY,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES bpo_plans(id) ON DELETE RESTRICT,
    plan_name VARCHAR(100) NOT NULL,
    price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    plan_badge VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM')),
    benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_limit INTEGER NOT NULL DEFAULT 0 CHECK (agent_limit >= 0),
    call_limit INTEGER NOT NULL DEFAULT 0 CHECK (call_limit >= 0),
    total_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_minutes >= 0),
    storage_amount NUMERIC(14,2) NOT NULL CHECK (storage_amount > 0),
    storage_unit VARCHAR(2) NOT NULL CHECK (storage_unit IN ('MB','GB')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE bpo_plan_purchases DROP CONSTRAINT IF EXISTS bpo_plan_purchases_plan_badge_check"),await l.query("ALTER TABLE bpo_plan_purchases ADD CONSTRAINT bpo_plan_purchases_plan_badge_check CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM'))"),await l.query("DROP INDEX IF EXISTS bpo_plan_purchases_one_active_idx"),await l.query("CREATE UNIQUE INDEX IF NOT EXISTS bpo_plan_purchases_unique_active_plan_idx ON bpo_plan_purchases(bpo_id,plan_id) WHERE is_active=TRUE"),await l.query("CREATE INDEX IF NOT EXISTS bpo_plan_purchases_bpo_id_idx ON bpo_plan_purchases(bpo_id, purchased_at DESC)"),await l.query(`CREATE TABLE IF NOT EXISTS agent_credentials (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('GROQ', 'TELNYX')),
    credential_id TEXT NOT NULL REFERENCES ai_credentials(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider),
    UNIQUE (agent_id, credential_id)
  )`),await l.query(`CREATE TABLE IF NOT EXISTS script_assignments (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    lead_file_name TEXT NOT NULL,
    script_file_name TEXT NOT NULL,
    lead_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
    lead_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    script_text TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE script_assignments ADD COLUMN IF NOT EXISTS lead_file_url TEXT, ADD COLUMN IF NOT EXISTS lead_file_type TEXT, ADD COLUMN IF NOT EXISTS script_file_url TEXT, ADD COLUMN IF NOT EXISTS script_file_type TEXT"),await l.query("ALTER TABLE script_assignments ADD COLUMN IF NOT EXISTS lead_file_size BIGINT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS script_file_size BIGINT NOT NULL DEFAULT 0"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_created_agents (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    voice_id TEXT REFERENCES admin_voices(id) ON DELETE SET NULL,
    voice_name VARCHAR(80) NOT NULL,
    source_script_id TEXT REFERENCES script_assignments(id) ON DELETE SET NULL,
    script_name TEXT NOT NULL,
    source_lead_id TEXT REFERENCES script_assignments(id) ON DELETE SET NULL,
    lead_file_name TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    dialing_mode VARCHAR(10) NOT NULL DEFAULT 'BOTH' CHECK (dialing_mode IN ('AUTO','MANUAL','BOTH')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS source_lead_id TEXT REFERENCES script_assignments(id) ON DELETE SET NULL"),await l.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS lead_file_name TEXT NOT NULL DEFAULT ''"),await l.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"),await l.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS dialing_mode VARCHAR(10) NOT NULL DEFAULT 'BOTH' CHECK (dialing_mode IN ('AUTO','MANUAL','BOTH'))"),await l.query(`UPDATE bpo_created_agents b SET lead_file_name=COALESCE((SELECT lead_file_name FROM script_assignments s WHERE s.agent_id=b.agent_id ORDER BY s.created_at DESC LIMIT 1),'')
    WHERE lead_file_name=''`),await l.query("CREATE INDEX IF NOT EXISTS bpo_created_agents_bpo_id_idx ON bpo_created_agents(bpo_id, created_at DESC)"),await l.query(`CREATE TABLE IF NOT EXISTS agent_call_schedules (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '17:00',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query("CREATE INDEX IF NOT EXISTS agent_call_schedules_enabled_idx ON agent_call_schedules(is_enabled) WHERE is_enabled=TRUE"),await l.query(`CREATE TABLE IF NOT EXISTS bpo_auto_dialer_settings (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '17:00',
    max_call_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_call_duration_seconds >= 0 AND max_call_duration_seconds <= 14400),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await l.query(`CREATE TABLE IF NOT EXISTS bpo_quick_dial_credentials (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`),await (0,f.ensureVoipSchema)(l),await l.query(`INSERT INTO agents (id, name, username, password_hash, gender, accent, status, role, approved_at)
    VALUES ('super-admin-zafar99', 'Zafar', 'zafar99', '$2b$12$2Jm8ZDqQRML7lkwjSLgxyuY5IrxLH6u3O1aGuaMOA7.isKrx6ybpa', 'OTHER', 'Professional', 'APPROVED', 'ADMIN', NOW())
    ON CONFLICT DO NOTHING`),await l.query("UPDATE agents SET admin_role = 'SUPER_ADMIN', email = COALESCE(email, 'admin@max7.ai') WHERE id = 'super-admin-zafar99'")}catch(a){if((a instanceof AggregateError&&Array.isArray(a.errors)?a.errors:[a]).some(a=>{let b=a&&"object"==typeof a&&"code"in a?a.code:void 0;return"ECONNREFUSED"===b})){let a=new URL(k);throw Error(`PostgreSQL is not reachable at ${a.hostname}:${a.port||"5432"}. Check DATABASE_URL and start the database, then restart the Next.js server.`)}throw a}}async function i(a={}){return!1===a.ensureSchema||(j.schemaReady&&37===j.schemaVersion||(j.schemaVersion=37,j.schemaReady=h().catch(a=>{throw j.schemaReady=void 0,j.schemaVersion=void 0,a})),await j.schemaReady),l}a.s(["db",0,i]),c()}catch(a){c(a)}},!1)];

//# sourceMappingURL=lib_1rc1s66._.js.map