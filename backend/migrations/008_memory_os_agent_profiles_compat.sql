-- Ensure Memory OS agent profile columns exist even if the quality-layer table predated migration 007.
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS expertise JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS successful_actions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS failed_actions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS preferred_tools JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS cost_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS speed_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS accuracy_notes TEXT;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS best_task_types JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS avoid_task_types JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW();
