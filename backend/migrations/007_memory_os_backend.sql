-- Memory OS backend schema. Defensive only: no destructive changes.

ALTER TABLE memories ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_tier TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance_score INT CHECK (importance_score IS NULL OR importance_score BETWEEN 1 AND 10);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS confidence_score FLOAT CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS structured_payload JSONB NOT NULL DEFAULT '{}';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS entities JSONB NOT NULL DEFAULT '[]';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS relationships JSONB NOT NULL DEFAULT '[]';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expiration_policy TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS retrieval_count INT NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;

-- Existing columns in older schema, repeated here for idempotent environments.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_category_check') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_category_check
      CHECK (category IS NULL OR category IN (
        'identity','preference','project','org','decision','governance',
        'repo','workflow','agent_profile','semantic','episodic','conflict','reflection'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_memory_tier_check') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_memory_tier_check
      CHECK (memory_tier IS NULL OR memory_tier IN ('working','episodic','semantic','decision','identity'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_org_id ON memories(org_id);
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_memory_tier ON memories(memory_tier);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);

CREATE TABLE IF NOT EXISTS memory_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID NOT NULL REFERENCES memories(id),
  version INT NOT NULL,
  content TEXT NOT NULL,
  structured_payload JSONB NOT NULL DEFAULT '{}',
  importance_score INT NOT NULL CHECK (importance_score BETWEEN 1 AND 10),
  confidence_score FLOAT NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_id ON memory_versions(memory_id, version DESC);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  old_memory_id UUID,
  new_memory_id UUID,
  conflict_type TEXT,
  old_claim TEXT,
  new_claim TEXT,
  old_confidence FLOAT,
  new_confidence FLOAT,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved',
  chosen_memory_id UUID,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Compatibility for the previously added quality-layer helper, if it created this table first.
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS old_memory_id UUID;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS new_memory_id UUID;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS conflict_type TEXT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS old_claim TEXT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS new_claim TEXT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS old_confidence FLOAT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS new_confidence FLOAT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS chosen_memory_id UUID;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE memory_conflicts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_memory_conflicts_status ON memory_conflicts(resolution_status, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_reflection_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID REFERENCES memories(id),
  reflection_type TEXT NOT NULL,
  issue_found TEXT,
  recommended_action TEXT,
  action_taken TEXT,
  confidence FLOAT CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_reflection_logs_created ON memory_reflection_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_reflection_logs_memory ON memory_reflection_logs(memory_id);

CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_id TEXT PRIMARY KEY,
  expertise JSONB NOT NULL DEFAULT '[]',
  successful_actions JSONB NOT NULL DEFAULT '[]',
  failed_actions JSONB NOT NULL DEFAULT '[]',
  preferred_tools JSONB NOT NULL DEFAULT '[]',
  cost_history JSONB NOT NULL DEFAULT '[]',
  speed_history JSONB NOT NULL DEFAULT '[]',
  accuracy_notes TEXT,
  best_task_types JSONB NOT NULL DEFAULT '[]',
  avoid_task_types JSONB NOT NULL DEFAULT '[]',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compatibility with the quality-layer profile JSON document shape.
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS profile JSONB;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS repo_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_summaries JSONB NOT NULL DEFAULT '[]',
  pr_summaries JSONB NOT NULL DEFAULT '[]',
  file_tree JSONB NOT NULL DEFAULT '[]',
  services JSONB NOT NULL DEFAULT '[]',
  apis JSONB NOT NULL DEFAULT '[]',
  db_schema JSONB NOT NULL DEFAULT '[]',
  routes JSONB NOT NULL DEFAULT '[]',
  components JSONB NOT NULL DEFAULT '[]',
  workflows JSONB NOT NULL DEFAULT '[]',
  architecture_decisions JSONB NOT NULL DEFAULT '[]',
  todos JSONB NOT NULL DEFAULT '[]',
  known_bugs JSONB NOT NULL DEFAULT '[]',
  roadmap JSONB NOT NULL DEFAULT '[]',
  deployment_notes JSONB NOT NULL DEFAULT '[]',
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, repo_name, branch)
);
CREATE INDEX IF NOT EXISTS idx_repo_memory_org ON repo_memory(org_id, repo_name);
CREATE INDEX IF NOT EXISTS idx_repo_memory_embedding ON repo_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
