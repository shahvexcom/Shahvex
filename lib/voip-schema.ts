import { ensureCampaignSchema } from "./campaign-schema";
export async function ensureVoipSchema(client: { query: (sql: string) => Promise<unknown> }) {
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS local_voice_id TEXT,
    ADD COLUMN IF NOT EXISTS agent_script TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS conversation_style TEXT NOT NULL DEFAULT 'Professional',
    ADD COLUMN IF NOT EXISTS speaks_first TEXT NOT NULL DEFAULT 'customer',
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English'`);
  await client.query(`CREATE TABLE IF NOT EXISTS local_voice_bootstrap(id TEXT PRIMARY KEY)`);
  await client.query(`CREATE TABLE IF NOT EXISTS local_voice_registry(
    id TEXT PRIMARY KEY,name VARCHAR(80) NOT NULL,gender TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'English',accent VARCHAR(100) NOT NULL DEFAULT '',
    owner_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,is_global BOOLEAN NOT NULL DEFAULT FALSE,
    reference_path TEXT,reference_transcript TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'PENDING',
    rights_verified BOOLEAN NOT NULL DEFAULT FALSE,transcript_verified BOOLEAN NOT NULL DEFAULT FALSE,service_trusted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS admin_agent_owners (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query("ALTER TABLE admin_agent_owners ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query(`CREATE TABLE IF NOT EXISTS voip_connections (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL, server_url TEXT NOT NULL, username VARCHAR(80) NOT NULL,
    secret_ciphertext TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'NON_AGENT_API', enabled BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'NOT_TESTED', last_tested_at TIMESTAMPTZ, status_message TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(id,owner_id)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS voip_agent_assignments (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, connection_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')), campaign_id VARCHAR(80) NOT NULL DEFAULT '',
    inbound_did VARCHAR(80) NOT NULL DEFAULT '', in_group VARCHAR(80) NOT NULL DEFAULT '', routing_destination VARCHAR(160) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(owner_id,agent_id),
    FOREIGN KEY(connection_id,owner_id) REFERENCES voip_connections(id,owner_id) ON DELETE RESTRICT
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS voip_connections_owner_idx ON voip_connections(owner_id)");
  await client.query("CREATE INDEX IF NOT EXISTS admin_agent_owners_owner_idx ON admin_agent_owners(owner_id)");
  await client.query(`ALTER TABLE voip_connections ADD COLUMN IF NOT EXISTS live_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS bridge_secret_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS recording_secret_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS media_verified_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telephony_provider TEXT NOT NULL DEFAULT 'TELNYX',
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
    ADD COLUMN IF NOT EXISTS vicidial_recording_url TEXT NOT NULL DEFAULT ''`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_vicidial_id_idx
    ON agent_calls(voip_connection_id,vicidial_call_id) WHERE vicidial_call_id IS NOT NULL`);
  await client.query(`CREATE TABLE IF NOT EXISTS vicidial_pools (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES voip_connections(id),
    owner_id TEXT NOT NULL REFERENCES agents(id), campaign_id TEXT NOT NULL, list_id TEXT NOT NULL,
    sheet_hash TEXT NOT NULL, script_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id,campaign_id,list_id,sheet_hash,script_hash)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS vicidial_pool_agents (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    pool_id TEXT NOT NULL REFERENCES vicidial_pools(id), remote_user TEXT NOT NULL,
    ready BOOLEAN NOT NULL DEFAULT FALSE, config JSONB NOT NULL, dialing_source TEXT NOT NULL DEFAULT 'DIRECT',
    max_call_duration_seconds INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS vicidial_pool_remote_user_idx
    ON vicidial_pool_agents(pool_id,remote_user)`);
  await client.query(`CREATE TABLE IF NOT EXISTS vicidial_lead_sync (
    connection_id TEXT NOT NULL REFERENCES voip_connections(id), list_id TEXT NOT NULL, phone_number TEXT NOT NULL,
    pool_id TEXT NOT NULL REFERENCES vicidial_pools(id), vendor_code TEXT NOT NULL,
    external_lead_id TEXT, state TEXT NOT NULL DEFAULT 'PENDING', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(connection_id,list_id,phone_number)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS vicidial_events (
    connection_id TEXT NOT NULL REFERENCES voip_connections(id), event_id TEXT NOT NULL,
    call_id TEXT, kind TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(connection_id,event_id)
  )`);

  await ensureCampaignSchema(client);

}
