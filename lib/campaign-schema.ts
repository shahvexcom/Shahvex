/** Additive campaign/runtime migration. Existing agents and call rows are retained. */
export const campaignMigration = `
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
`;
export async function ensureCampaignSchema(client:{query:(sql:string)=>Promise<unknown>}) { await client.query(campaignMigration); }
