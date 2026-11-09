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
}
