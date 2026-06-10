CREATE TABLE IF NOT EXISTS agent_skills (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    TEXT NOT NULL,
  skill_name  TEXT NOT NULL,
  version     INT NOT NULL,
  enabled     BOOLEAN DEFAULT TRUE,
  priority    INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);

CREATE TABLE IF NOT EXISTS skill_activations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    TEXT NOT NULL,
  skill_name  TEXT NOT NULL,
  version     INT NOT NULL,
  context     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_activations_agent ON skill_activations(agent_id, created_at DESC);
