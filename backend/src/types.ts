export type JsonObject = Record<string, unknown>;

export type Step = {
  tool: string;
  input: unknown;
  output: unknown;
  success: boolean;
};

export type WorkflowRun = {
  name: string;
  steps: Step[];
  outcome: 'success' | 'failure';
  duration_ms: number;
  tools_used: string[];
  error?: string;
};

export type BudgetConfig = {
  token_budget: number;
  cpu_budget_pct: number;
  mem_budget_mb: number;
  priority: 'critical' | 'high' | 'normal' | 'low' | 'background';
};
