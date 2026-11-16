BEGIN;
CREATE TABLE IF NOT EXISTS agent_campaign_preferences(
 agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES agents(id),category_id TEXT REFERENCES campaign_categories(id) ON DELETE SET NULL,
 external_campaign_id VARCHAR(80) NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
COMMIT;
