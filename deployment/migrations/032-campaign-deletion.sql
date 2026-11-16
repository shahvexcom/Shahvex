-- Campaign removal retains historical call and runtime references.
BEGIN;
ALTER TABLE campaign_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
COMMIT;
