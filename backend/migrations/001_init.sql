-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Memory type enum
CREATE TYPE memory_type AS ENUM (
  'user', 'agent', 'project', 'workspace', 'org', 'procedural', 'decision', 'archived'
);

CREATE TYPE memory_importance AS ENUM ('critical', 'high', 'medium', 'low');

-- Core memory table
CREATE TABLE IF NOT EXISTS memories (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_type    memory_type NOT NULL,
  key            TEXT NOT NULL,
  content        TEXT NOT NULL,
  embedding      vector(1536),
  importance     FLOAT NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  confidence     FLOAT NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  recency        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source         TEXT,
  version        INT NOT NULL DEFAULT 1,
  superseded_by  UUID REFERENCES memories(id),
  workspace_id   TEXT,
  agent_id       TEXT,
  tags           TEXT[] DEFAULT '{}',
  audit_log      JSONB NOT NULL DEFAULT '[]',
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versioning index
CREATE INDEX idx_memories_key ON memories(key);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_workspace ON memories(workspace_id);
CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_memories_recency ON memories(recency DESC);
CREATE INDEX idx_memories_active ON memories(superseded_by) WHERE superseded_by IS NULL;
-- pgvector cosine similarity index
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Procedural memory table
CREATE TABLE IF NOT EXISTS procedural_memories (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL,
  tool_sequence  JSONB NOT NULL DEFAULT '[]',
  prerequisites  JSONB NOT NULL DEFAULT '[]',
  failure_modes  JSONB NOT NULL DEFAULT '[]',
  validation_steps JSONB NOT NULL DEFAULT '[]',
  success_rate   FLOAT DEFAULT 0,
  run_count      INT DEFAULT 0,
  last_used      TIMESTAMPTZ,
  version        INT DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Learning loop ledger
CREATE TABLE IF NOT EXISTS learning_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  lesson         TEXT,
  failure_mode   TEXT,
  improvement    TEXT,
  importance     FLOAT DEFAULT 0,
  context        JSONB DEFAULT '{}',
  agent_id       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Self-improvement skill tracking
CREATE TABLE IF NOT EXISTS skill_versions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_name     TEXT NOT NULL,
  version        INT NOT NULL,
  definition     JSONB NOT NULL,
  success_rate   FLOAT DEFAULT 0,
  failure_log    JSONB DEFAULT '[]',
  changelog      TEXT,
  approved       BOOLEAN DEFAULT FALSE,
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  rolled_back    BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(skill_name, version)
);

-- Agent resource budgets
CREATE TABLE IF NOT EXISTS agent_budgets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       TEXT NOT NULL UNIQUE,
  token_budget   INT DEFAULT 50000,
  tokens_used    INT DEFAULT 0,
  cpu_budget_pct FLOAT DEFAULT 50,
  mem_budget_mb  INT DEFAULT 512,
  priority       TEXT DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','low','background')),
  status         TEXT DEFAULT 'active' CHECK (status IN ('active','hibernating','throttled','killed')),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Security workspace findings
CREATE TABLE IF NOT EXISTS security_findings (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team           TEXT NOT NULL CHECK (team IN ('red','blue','purple')),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  status         TEXT DEFAULT 'open' CHECK (status IN ('open','triaged','remediated','retested','closed')),
  level          INT DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  approved_by    TEXT,
  evidence       JSONB DEFAULT '{}',
  remediation    TEXT,
  linked_finding UUID REFERENCES security_findings(id),
  agent_id       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Governance approvals
CREATE TABLE IF NOT EXISTS approvals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_type  TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  action         TEXT NOT NULL,
  requested_by   TEXT NOT NULL,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  reason         TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type     TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT,
  actor          TEXT,
  payload        JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Kill switch state
CREATE TABLE IF NOT EXISTS kill_switch (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active         BOOLEAN DEFAULT FALSE,
  activated_by   TEXT,
  activated_at   TIMESTAMPTZ,
  reason         TEXT
);
INSERT INTO kill_switch(id, active) VALUES(1, FALSE) ON CONFLICT DO NOTHING;

-- IOC tracking
CREATE TABLE IF NOT EXISTS ioc_tracker (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ioc_type       TEXT NOT NULL,
  value          TEXT NOT NULL,
  severity       TEXT DEFAULT 'medium',
  description    TEXT,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Incident tracker
CREATE TABLE IF NOT EXISTS incidents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title          TEXT NOT NULL,
  description    TEXT,
  severity       TEXT DEFAULT 'medium',
  status         TEXT DEFAULT 'open' CHECK (status IN ('open','investigating','contained','resolved','closed')),
  assigned_to    TEXT,
  findings       UUID[],
  timeline       JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
