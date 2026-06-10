import { appendAudit, query } from '../db/client.js';
import { BudgetConfig } from '../types.js';

const HEARTBEAT_ENABLED = process.env.OPENCLAW_HEARTBEAT_ENABLED === 'true';

export async function registerAgent(agentId: string, config: BudgetConfig) {
  const result = await query(
    `INSERT INTO agent_budgets(agent_id, token_budget, cpu_budget_pct, mem_budget_mb, priority, status, last_heartbeat)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       token_budget = EXCLUDED.token_budget,
       cpu_budget_pct = EXCLUDED.cpu_budget_pct,
       mem_budget_mb = EXCLUDED.mem_budget_mb,
       priority = EXCLUDED.priority,
       status = 'active',
       updated_at = NOW()
     RETURNING *`,
    [agentId, config.token_budget, config.cpu_budget_pct, config.mem_budget_mb, config.priority],
  );
  return result.rows[0];
}

export async function heartbeat(agentId: string) {
  if (!HEARTBEAT_ENABLED) {
    return getAgent(agentId);
  }

  const result = await query('UPDATE agent_budgets SET last_heartbeat = NOW(), updated_at = NOW() WHERE agent_id = $1 RETURNING *', [agentId]);
  return result.rows[0] ?? null;
}

export async function recordTokenUsage(agentId: string, tokens: number) {
  // Reset window if expired before adding new usage
  await query(
    `UPDATE agent_budgets
     SET token_window_used = 0, token_window_start = NOW()
     WHERE agent_id = $1
       AND NOW() > token_window_start + (token_window_seconds || ' seconds')::interval`,
    [agentId],
  );
  const result = await query(
    `UPDATE agent_budgets
     SET tokens_used = tokens_used + $2,
         token_window_used = token_window_used + $2,
         updated_at = NOW()
     WHERE agent_id = $1 RETURNING *`,
    [agentId, tokens],
  );
  if (!result.rows[0]) return null;
  return checkRunaway(result.rows[0]);
}

export async function checkRunaway(agent: Record<string, any>) {
  // Runaway = exceeded 3× budget WITHIN the current time window (not lifetime)
  const windowUsed = Number(agent.token_window_used ?? 0);
  const budget     = Number(agent.token_budget ?? 50000);
  if (windowUsed > budget * 3) {
    const killed = await query(
      `UPDATE agent_budgets SET status = 'killed', updated_at = NOW() WHERE agent_id = $1 RETURNING *`,
      [agent.agent_id],
    );
    await appendAudit('agent_killed_runaway', 'agent_budgets', agent.agent_id, 'resource-manager', {
      window_used: windowUsed,
      token_budget: budget,
      window_seconds: agent.token_window_seconds,
    });
    return killed.rows[0];
  }
  return agent;
}

export async function checkZombie() {
  if (!HEARTBEAT_ENABLED) {
    return [];
  }

  const result = await query(
    `UPDATE agent_budgets
     SET status = 'killed', updated_at = NOW()
     WHERE last_heartbeat < NOW() - INTERVAL '2 minutes' AND status <> 'killed'
     RETURNING *`,
  );
  for (const agent of result.rows) {
    await appendAudit('agent_killed_zombie', 'agent_budgets', agent.agent_id, 'resource-manager', {});
  }
  return result.rows;
}

export async function hibernateAgent(agentId: string) {
  return setStatus(agentId, 'hibernating');
}

export async function throttleAgent(agentId: string) {
  return setStatus(agentId, 'throttled');
}

export async function wakeAgent(agentId: string) {
  const result = await query(
    `UPDATE agent_budgets SET status = 'active', tokens_used = 0, last_heartbeat = NOW(), updated_at = NOW()
     WHERE agent_id = $1 RETURNING *`,
    [agentId],
  );
  return result.rows[0] ?? null;
}

async function setStatus(agentId: string, status: 'hibernating' | 'throttled' | 'killed') {
  const result = await query('UPDATE agent_budgets SET status = $2, updated_at = NOW() WHERE agent_id = $1 RETURNING *', [agentId, status]);
  return result.rows[0] ?? null;
}

export async function getPriorityQueue() {
  const result = await query(
    `SELECT * FROM agent_budgets
     ORDER BY CASE priority
       WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5
     END, updated_at DESC`,
  );
  return result.rows;
}

export async function getAgent(agentId: string) {
  const result = await query('SELECT * FROM agent_budgets WHERE agent_id = $1', [agentId]);
  return result.rows[0] ?? null;
}
