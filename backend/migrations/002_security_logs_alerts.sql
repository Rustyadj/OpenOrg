CREATE TABLE IF NOT EXISTS security_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      TEXT,
  level       TEXT DEFAULT 'info',
  message     TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  severity    TEXT DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','info')),
  status      TEXT DEFAULT 'open' CHECK (status IN ('open','triaged','closed')),
  source      TEXT,
  finding_id  UUID REFERENCES security_findings(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
