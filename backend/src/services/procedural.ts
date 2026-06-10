import { query } from '../db/client.js';
import { WorkflowRun } from '../types.js';

export type Procedure = {
  name: string;
  description: string;
  tool_sequence: Array<{ tool: string; success: boolean }>;
  prerequisites: string[];
  failure_modes: string[];
  validation_steps: string[];
  success?: boolean;
};

export function extractProcedure(workflow: WorkflowRun): Procedure {
  const failedSteps = workflow.steps.filter((step) => !step.success);
  const tools = workflow.steps.map((step) => step.tool);
  return {
    name: workflow.name,
    description: `${workflow.name} workflow with ${workflow.steps.length} steps completed as ${workflow.outcome} in ${workflow.duration_ms}ms.`,
    tool_sequence: workflow.steps.map((step) => ({ tool: step.tool, success: step.success })),
    prerequisites: Array.from(new Set(workflow.tools_used.length ? workflow.tools_used : tools)).map((tool) => `Tool available: ${tool}`),
    failure_modes: [
      ...failedSteps.map((step) => `Step failed: ${step.tool}`),
      ...(workflow.error ? [workflow.error] : []),
    ],
    validation_steps: workflow.steps.filter((step) => step.success).map((step) => `Validate ${step.tool} output`),
    success: workflow.outcome === 'success',
  };
}

export async function saveProcedure(proc: Procedure) {
  const successDelta = proc.success === false ? 0 : 1;
  const runDelta = proc.success === undefined ? 0 : 1;
  const result = await query(
    `INSERT INTO procedural_memories(name, description, tool_sequence, prerequisites, failure_modes, validation_steps, success_rate, run_count, last_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (name) DO UPDATE SET
       description = EXCLUDED.description,
       tool_sequence = EXCLUDED.tool_sequence,
       prerequisites = EXCLUDED.prerequisites,
       failure_modes = EXCLUDED.failure_modes,
       validation_steps = EXCLUDED.validation_steps,
       success_rate = CASE
         WHEN procedural_memories.run_count + $8 = 0 THEN procedural_memories.success_rate
         ELSE ((procedural_memories.success_rate * procedural_memories.run_count) + $7) / (procedural_memories.run_count + $8)
       END,
       run_count = procedural_memories.run_count + $8,
       last_used = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      proc.name,
      proc.description,
      JSON.stringify(proc.tool_sequence),
      JSON.stringify(proc.prerequisites),
      JSON.stringify(proc.failure_modes),
      JSON.stringify(proc.validation_steps),
      successDelta,
      runDelta,
    ],
  );
  return result.rows[0];
}

export async function updateProcedureOutcome(name: string, success: boolean) {
  const result = await query(
    `UPDATE procedural_memories
     SET success_rate = ((success_rate * run_count) + $2) / (run_count + 1),
         run_count = run_count + 1,
         last_used = NOW(),
         updated_at = NOW()
     WHERE name = $1
     RETURNING *`,
    [name, success ? 1 : 0],
  );
  return result.rows[0] ?? null;
}

export async function getProcedure(name: string) {
  const result = await query('SELECT * FROM procedural_memories WHERE name = $1', [name]);
  return result.rows[0] ?? null;
}

export async function listProcedures() {
  const result = await query('SELECT * FROM procedural_memories ORDER BY success_rate DESC, updated_at DESC');
  return result.rows;
}
