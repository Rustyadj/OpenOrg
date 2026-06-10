export type MemoryType = 'user' | 'agent' | 'project' | 'workspace' | 'org' | 'procedural' | 'decision' | 'archived';

export interface Memory {
  id: string;
  memory_type: MemoryType;
  key: string;
  content: string;
  embedding?: number[];
  importance: number;
  confidence: number;
  recency: string;
  source?: string;
  version: number;
  superseded_by?: string;
  workspace_id?: string;
  agent_id?: string;
  tags: string[];
  audit_log: AuditEntry[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  action: string;
  actor?: string;
  timestamp: string;
  diff?: Record<string, unknown>;
}

export interface SearchResult extends Memory {
  score: number;
}

export interface BudgetTier {
  tier: 'normal' | 'complex';
  max_tokens: number;
}

export const BUDGET_TIERS: Record<string, BudgetTier> = {
  normal:  { tier: 'normal',  max_tokens: 2000 },
  complex: { tier: 'complex', max_tokens: 5000 },
};

export interface WorkflowStep {
  tool: string;
  input: unknown;
  output: unknown;
  success: boolean;
}

export interface WorkflowRun {
  name: string;
  steps: WorkflowStep[];
  outcome: 'success' | 'failure';
  duration_ms: number;
  tools_used: string[];
  error?: string;
}

export interface BudgetConfig {
  token_budget: number;
  cpu_budget_pct: number;
  mem_budget_mb: number;
  priority: 'critical' | 'high' | 'normal' | 'low' | 'background';
}
