-- Additive connection deletion marker; historical call references are retained.
BEGIN;
ALTER TABLE voip_connections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE campaign_definitions ADD COLUMN IF NOT EXISTS script_extraction_hash TEXT NOT NULL DEFAULT '';
COMMIT;
