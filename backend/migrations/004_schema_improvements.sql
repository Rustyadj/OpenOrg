-- 1. Move audit_log off the memories row into a dedicated table
CREATE TABLE IF NOT EXISTS memory_audit (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id   UUID NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT,
  diff        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_audit_memory_id ON memory_audit(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_audit_created_at ON memory_audit(created_at DESC);

-- 2. Migrate existing inline audit_log rows to new table
INSERT INTO memory_audit(memory_id, action, actor, diff, created_at)
SELECT
  id,
  (entry->>'action')::text,
  entry->>'actor',
  COALESCE(entry->'diff', '{}'),
  COALESCE((entry->>'timestamp')::timestamptz, created_at)
FROM memories, jsonb_array_elements(COALESCE(audit_log, '[]'::jsonb)) AS entry
WHERE audit_log IS NOT NULL AND jsonb_array_length(audit_log) > 0
ON CONFLICT DO NOTHING;

-- 3. Drop the inline audit_log column from memories
ALTER TABLE memories DROP COLUMN IF EXISTS audit_log;

-- 4. Move skill_versions.failure_log to a separate outcomes table
CREATE TABLE IF NOT EXISTS skill_outcomes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_name  TEXT NOT NULL,
  version     INT NOT NULL,
  agent_id    TEXT,
  success     BOOLEAN NOT NULL,
  feedback    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_outcomes_skill ON skill_outcomes(skill_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_outcomes_agent ON skill_outcomes(agent_id, created_at DESC);

-- Migrate existing failure_log data
INSERT INTO skill_outcomes(skill_name, version, agent_id, success, feedback, created_at)
SELECT
  sv.skill_name,
  sv.version,
  entry->>'agentId',
  (entry->>'success')::boolean,
  entry->>'feedback',
  COALESCE((entry->>'at')::timestamptz, sv.created_at)
FROM skill_versions sv,
  jsonb_array_elements(COALESCE(sv.failure_log, '[]'::jsonb)) AS entry
WHERE sv.failure_log IS NOT NULL AND jsonb_array_length(sv.failure_log) > 0
ON CONFLICT DO NOTHING;

-- Drop failure_log column from skill_versions
ALTER TABLE skill_versions DROP COLUMN IF EXISTS failure_log;

-- 5. Add per-agent memory limits to agent_budgets
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS max_memory_records INT DEFAULT 500;
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS max_memory_tokens  INT DEFAULT 100000;

-- 6. Add per-agent learning loop config
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS learning_enabled       BOOLEAN DEFAULT TRUE;
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS learning_threshold     FLOAT   DEFAULT 0.6;
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS token_window_seconds   INT     DEFAULT 60;
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS token_window_used      INT     DEFAULT 0;
ALTER TABLE agent_budgets ADD COLUMN IF NOT EXISTS token_window_start     TIMESTAMPTZ DEFAULT NOW();

-- 7. Add deduplication hash to learning_events (prevents storing same lesson twice)
ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_events_hash ON learning_events(content_hash)
  WHERE content_hash IS NOT NULL;

-- 8. Fix incidents.findings as a proper junction table
CREATE TABLE IF NOT EXISTS incident_findings (
  incident_id UUID NOT NULL,
  finding_id  UUID NOT NULL REFERENCES security_findings(id),
  PRIMARY KEY (incident_id, finding_id)
);
