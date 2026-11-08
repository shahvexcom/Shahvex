import { Pool } from "pg";

const SCHEMA_VERSION = 24;
const globalForDb = globalThis as unknown as { pool?: Pool; schemaReady?: Promise<void>; schemaVersion?: number };
// pg v8 warns for `sslmode=require`; `verify-full` preserves its current
// behaviour and is the explicit mode required by the upcoming pg release.
function configuredDatabaseUrl() {
  const value = [process.env.DATABASE_URL, process.env.DIRECT_URL].find(candidate => candidate?.trim());
  if (!value) {
    throw new Error("Database is not configured. Set a non-empty DATABASE_URL or DIRECT_URL, then restart the Next.js server.");
  }
  return value.trim().replace(/([?&])sslmode=require(?=&|$)/i, "$1sslmode=verify-full");
}

const connectionString = configuredDatabaseUrl();
const pool = globalForDb.pool ?? new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

async function ensureSchema() {
  try {
    await pool.query(`
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
  `);
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS call_limit_minutes INTEGER");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_call_limit INTEGER NOT NULL DEFAULT 25");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email VARCHAR(254)");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone VARCHAR(40)");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(64)");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS admin_role VARCHAR(80) NOT NULL DEFAULT 'SUB_ADMIN'");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS admin_permissions JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_secret TEXT");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS overall_credits NUMERIC(14,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS remaining_credits NUMERIC(14,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS block_reason TEXT NOT NULL DEFAULT ''");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_credit_contact_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    whatsapp_url TEXT NOT NULL,
    instagram_url TEXT NOT NULL,
    messenger_url TEXT NOT NULL,
    updated_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(
    `INSERT INTO bpo_credit_contact_settings (id,whatsapp_url,instagram_url,messenger_url)
     VALUES (1,$1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [
      process.env.NEXT_PUBLIC_BPO_WHATSAPP || "https://wa.me/",
      process.env.NEXT_PUBLIC_BPO_INSTAGRAM || "https://instagram.com/",
      process.env.NEXT_PUBLIC_BPO_MESSENGER || "https://m.me/",
    ],
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_credit_transactions (
    id TEXT PRIMARY KEY,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    loaded_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_credit_transactions_bpo_id_idx ON bpo_credit_transactions(bpo_id, created_at DESC)");
  await pool.query("ALTER TABLE bpo_credit_transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(12) NOT NULL DEFAULT 'LOAD'");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_usage_pricing (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
    agent_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (agent_unit_price >= 0),
    call_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (call_unit_price >= 0),
    minute_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (minute_unit_price >= 0),
    recording_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (recording_unit_price >= 0),
    storage_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (storage_unit_price >= 0),
    storage_unit VARCHAR(2) NOT NULL DEFAULT 'GB' CHECK (storage_unit IN ('MB','GB')),
    updated_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE bpo_usage_pricing ADD COLUMN IF NOT EXISTS storage_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (storage_unit_price >= 0), ADD COLUMN IF NOT EXISTS storage_unit VARCHAR(2) NOT NULL DEFAULT 'GB' CHECK (storage_unit IN ('MB','GB'))");
  await pool.query("INSERT INTO bpo_usage_pricing (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_usage_addon_purchases (
    id TEXT PRIMARY KEY,
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    product_type VARCHAR(12) NOT NULL CHECK (product_type IN ('AGENT','CALL','MINUTE','RECORDING','STORAGE')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(14,2) NOT NULL CHECK (total_price >= 0),
    storage_unit VARCHAR(2) CHECK (storage_unit IN ('MB','GB')),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE bpo_usage_addon_purchases ADD COLUMN IF NOT EXISTS storage_unit VARCHAR(2) CHECK (storage_unit IN ('MB','GB'))");
  await pool.query("ALTER TABLE bpo_usage_addon_purchases DROP CONSTRAINT IF EXISTS bpo_usage_addon_purchases_product_type_check");
  await pool.query("ALTER TABLE bpo_usage_addon_purchases ADD CONSTRAINT bpo_usage_addon_purchases_product_type_check CHECK (product_type IN ('AGENT','CALL','MINUTE','RECORDING','STORAGE'))");
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_usage_addon_purchases_bpo_id_idx ON bpo_usage_addon_purchases(bpo_id,purchased_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_calls (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telnyx_call_control_id TEXT, ADD COLUMN IF NOT EXISTS telnyx_call_session_id TEXT, ADD COLUMN IF NOT EXISTS telnyx_connection_id TEXT, ADD COLUMN IF NOT EXISTS lead_name TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS lead_number VARCHAR(40) NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS recording_url TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS recording_id TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS recording_size_bytes BIGINT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS conversation_busy BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS conversation_state VARCHAR(30) NOT NULL DEFAULT 'INITIALIZING', ADD COLUMN IF NOT EXISTS current_response_id TEXT, ADD COLUMN IF NOT EXISTS failure_reason TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS telnyx_ai_conversation_id TEXT");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS recording_active BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS on_hold BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS start_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS mid_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS final_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS ending_requested BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS quick_dial_minute_rate NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_recording_rate NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_charge NUMERIC(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS quick_dial_settled BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS call_type VARCHAR(20) NOT NULL DEFAULT 'LEAD'");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS silence_prompt_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS interruption_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS misunderstanding_count INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS pending_client_text TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS pending_client_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS dialing_source VARCHAR(12) NOT NULL DEFAULT 'DIRECT' CHECK (dialing_source IN ('DIRECT','MANUAL','AUTO'))");
  await pool.query("ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS max_call_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_call_duration_seconds >= 0)");
  // Older Quick Dial calls used the same table as lead calls.  Keep them for
  // auditing, but do not let them appear in the lead-agent workflow.
  await pool.query("UPDATE agent_calls SET call_type='QUICK_DIAL' WHERE lead_name='Quick dial' AND call_type='LEAD'");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_telnyx_call_control_id_idx ON agent_calls(telnyx_call_control_id) WHERE telnyx_call_control_id IS NOT NULL");
  // Quick Dial uses these predicates on every dashboard refresh and before a
  // new call starts. Keep that path indexed even when the call audit grows.
  await pool.query("CREATE INDEX IF NOT EXISTS agent_calls_quick_dial_lookup_idx ON agent_calls(agent_id, call_type, created_at DESC)");
  // A phone number belongs to the first agent that claims it.  This makes lead
  // ownership durable across restarts and prevents two agents from dialing the
  // same sheet row concurrently.
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_claims (
    lead_number VARCHAR(40) PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    call_id TEXT,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("INSERT INTO lead_claims (lead_number,agent_id,call_id) SELECT lead_number,agent_id,id FROM agent_calls WHERE lead_number<>'' ON CONFLICT (lead_number) DO NOTHING");
  await pool.query(`UPDATE lead_claims lc SET call_id=c.id,agent_id=c.agent_id
    FROM (SELECT DISTINCT ON (lead_number) id,agent_id,lead_number FROM agent_calls WHERE lead_number<>'' ORDER BY lead_number,created_at ASC) c
    WHERE lc.lead_number=c.lead_number AND lc.call_id IS NULL`);
  await pool.query("DELETE FROM lead_claims WHERE call_id IS NULL AND claimed_at < NOW() - INTERVAL '10 minutes'");
  await pool.query("CREATE TABLE IF NOT EXISTS telnyx_webhook_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query(`CREATE TABLE IF NOT EXISTS do_not_call (
    phone_number VARCHAR(40) PRIMARY KEY,
    source_call_id TEXT,
    reason TEXT NOT NULL DEFAULT 'Customer opt-out',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'NEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_roles (
    id TEXT PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_preferences (
    admin_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    interface_sounds_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    background_sound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_credentials (
    id TEXT PRIMARY KEY,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('GROQ', 'TELNYX')),
    label VARCHAR(80) NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    updated_by TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ai_credentials_provider_idx ON ai_credentials(provider)");
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_voices (
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
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_voice_assignments (
    bpo_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    voice_id TEXT NOT NULL REFERENCES admin_voices(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bpo_id, voice_id)
  )`);
  await pool.query("ALTER TABLE bpo_voice_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_voice_assignments_voice_id_idx ON bpo_voice_assignments(voice_id)");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_voice_preferences (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    auto_voice_id TEXT REFERENCES admin_voices(id) ON DELETE SET NULL,
    manual_voice_id TEXT REFERENCES admin_voices(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_plans (
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
  )`);
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS total_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_minutes >= 0)");
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS agent_limit INTEGER NOT NULL DEFAULT 0 CHECK (agent_limit >= 0)");
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS plan_badge VARCHAR(12) NOT NULL DEFAULT 'STANDARD'");
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS plan_kind VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (plan_kind IN ('STANDARD','CUSTOM'))");
  await pool.query("ALTER TABLE bpo_plans ADD COLUMN IF NOT EXISTS assigned_bpo_id TEXT REFERENCES agents(id) ON DELETE CASCADE");
  await pool.query("ALTER TABLE bpo_plans DROP CONSTRAINT IF EXISTS bpo_plans_plan_badge_check");
  await pool.query("ALTER TABLE bpo_plans ADD CONSTRAINT bpo_plans_plan_badge_check CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM'))");
  await pool.query("UPDATE bpo_plans SET plan_badge='RECOMMENDED' WHERE is_recommended=TRUE AND plan_badge='STANDARD'");
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_plans_updated_at_idx ON bpo_plans(updated_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_plans_assigned_bpo_id_idx ON bpo_plans(assigned_bpo_id) WHERE assigned_bpo_id IS NOT NULL");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_plan_purchases (
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
  )`);
  await pool.query("ALTER TABLE bpo_plan_purchases DROP CONSTRAINT IF EXISTS bpo_plan_purchases_plan_badge_check");
  await pool.query("ALTER TABLE bpo_plan_purchases ADD CONSTRAINT bpo_plan_purchases_plan_badge_check CHECK (plan_badge IN ('STANDARD','RECOMMENDED','EXCLUSIVE','CUSTOM'))");
  await pool.query("DROP INDEX IF EXISTS bpo_plan_purchases_one_active_idx");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS bpo_plan_purchases_unique_active_plan_idx ON bpo_plan_purchases(bpo_id,plan_id) WHERE is_active=TRUE");
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_plan_purchases_bpo_id_idx ON bpo_plan_purchases(bpo_id, purchased_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_credentials (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('GROQ', 'TELNYX')),
    credential_id TEXT NOT NULL REFERENCES ai_credentials(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider),
    UNIQUE (agent_id, credential_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS script_assignments (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    lead_file_name TEXT NOT NULL,
    script_file_name TEXT NOT NULL,
    lead_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
    lead_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    script_text TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE script_assignments ADD COLUMN IF NOT EXISTS lead_file_url TEXT, ADD COLUMN IF NOT EXISTS lead_file_type TEXT, ADD COLUMN IF NOT EXISTS script_file_url TEXT, ADD COLUMN IF NOT EXISTS script_file_type TEXT");
  await pool.query("ALTER TABLE script_assignments ADD COLUMN IF NOT EXISTS lead_file_size BIGINT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS script_file_size BIGINT NOT NULL DEFAULT 0");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_created_agents (
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
  )`);
  await pool.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS source_lead_id TEXT REFERENCES script_assignments(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS lead_file_name TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE bpo_created_agents ADD COLUMN IF NOT EXISTS dialing_mode VARCHAR(10) NOT NULL DEFAULT 'BOTH' CHECK (dialing_mode IN ('AUTO','MANUAL','BOTH'))");
  await pool.query(`UPDATE bpo_created_agents b SET lead_file_name=COALESCE((SELECT lead_file_name FROM script_assignments s WHERE s.agent_id=b.agent_id ORDER BY s.created_at DESC LIMIT 1),'')
    WHERE lead_file_name=''`);
  await pool.query("CREATE INDEX IF NOT EXISTS bpo_created_agents_bpo_id_idx ON bpo_created_agents(bpo_id, created_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_call_schedules (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '17:00',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS agent_call_schedules_enabled_idx ON agent_call_schedules(is_enabled) WHERE is_enabled=TRUE");
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_auto_dialer_settings (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '17:00',
    max_call_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_call_duration_seconds >= 0 AND max_call_duration_seconds <= 14400),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // A short-lived Telephony Credential is issued per BPO softphone.  The
  // Telnyx API key never leaves the server; the browser only receives a JWT.
  await pool.query(`CREATE TABLE IF NOT EXISTS bpo_quick_dial_credentials (
    bpo_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // The initial owner is provisioned once. Passwords are stored as bcrypt hashes,
  // never as plaintext values.
  await pool.query(`INSERT INTO agents (id, name, username, password_hash, gender, accent, status, role, approved_at)
    VALUES ('super-admin-zafar99', 'Zafar', 'zafar99', '$2b$12$2Jm8ZDqQRML7lkwjSLgxyuY5IrxLH6u3O1aGuaMOA7.isKrx6ybpa', 'OTHER', 'Professional', 'APPROVED', 'ADMIN', NOW())
    ON CONFLICT DO NOTHING`);
    await pool.query("UPDATE agents SET admin_role = 'SUPER_ADMIN', email = COALESCE(email, 'admin@max7.ai') WHERE id = 'super-admin-zafar99'");
  } catch (error) {
    const connectionErrors = error instanceof AggregateError && Array.isArray(error.errors)
      ? error.errors
      : [error];
    if (connectionErrors.some(item => {
      const code = item && typeof item === "object" && "code" in item ? item.code : undefined;
      return code === "ECONNREFUSED";
    })) {
      const target = new URL(connectionString);
      // Do not attach the AggregateError as a cause: Next's Server Component
      // error serialization can itself fail on the nested connection errors.
      throw new Error(`PostgreSQL is not reachable at ${target.hostname}:${target.port || "5432"}. Check DATABASE_URL and start the database, then restart the Next.js server.`);
    }
    throw error;
  }
}

export async function db(options: { ensureSchema?: boolean } = {}) {
  // Authentication is a hot path and must not be held hostage by unrelated
  // application migrations. The agents table is part of the bootstrap schema,
  // so existing deployments can query it directly while normal application
  // routes continue to run the full schema check once per server process.
  if (options.ensureSchema === false) return pool;

  // Schema work must not run on every request. Besides slowing every login,
  // concurrent login requests repeatedly running DDL can exhaust a hosted
  // Postgres connection and make both portals appear unable to sign in.
  if (!globalForDb.schemaReady || globalForDb.schemaVersion !== SCHEMA_VERSION) {
    globalForDb.schemaVersion = SCHEMA_VERSION;
    globalForDb.schemaReady = ensureSchema().catch((error) => {
      globalForDb.schemaReady = undefined;
      globalForDb.schemaVersion = undefined;
      throw error;
    });
  }
  await globalForDb.schemaReady;
  return pool;
}
