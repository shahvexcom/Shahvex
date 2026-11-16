-- Retain call and lead history when controller-created agents are removed.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
