import crypto from 'node:crypto';
import { appendAudit, query } from '../db/client.js';
import { embed, cosineSimilarity } from './embed.js';
import { getOpenAI } from './openai.js';
import { detectRegressions, proposeSkillUpdate, trackOutcome } from './selfimprovement.js';

export type SkillContext = {
  skill_name: string;
  version: number;
  definition: Record<string, unknown>;
  success_rate: number;
  instructions?: string;
  token_count: number;
  task_relevance?: number; // 0-1, only set when task_context was provided
};

export type ActuatorResult = {
  agent_id: string;
  skills: SkillContext[];
  total_tokens: number;
  token_budget_used: number;
  context_block: string;
};

type AssignedSkill = {
  skill_name: string;
  version: number;
  priority: number;
};

type CacheEntry = {
  expires_at: number;
  result: ActuatorResult;
};

const CACHE_TTL_MS = 60_000;
// Context result cache: agentId:maxTokens:taskContextHash → ActuatorResult
const contextCache = new Map<string, CacheEntry>();
// Skill instruction embedding cache: sha256(instructions) → vector
// No TTL — invalidated when skill is reassigned or updated
const instructionEmbeddingCache = new Map<string, number[]>();

function cacheKey(agentId: string, taskContext?: string, maxTokens = 500): string {
  const ctxHash = taskContext
    ? crypto.createHash('sha256').update(taskContext).digest('hex').slice(0, 12)
    : '';
  return `${agentId}:${maxTokens}:${ctxHash}`;
}

export function invalidateAgentSkillCache(agentId: string): void {
  for (const key of contextCache.keys()) {
    if (key.startsWith(`${agentId}:`)) contextCache.delete(key);
  }
}

function tokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function instructionFromDefinition(def: Record<string, unknown>): string | null {
  if (typeof def.instructions === 'string' && def.instructions.trim()) return def.instructions.trim();
  if (typeof def.description  === 'string' && def.description.trim())  return def.description.trim();
  return null;
}

async function loadApprovedSkill(skillName: string, version?: number) {
  const result = version
    ? await query(
        `SELECT * FROM skill_versions
         WHERE skill_name = $1 AND version = $2 AND approved = TRUE AND rolled_back = FALSE
         LIMIT 1`,
        [skillName, version],
      )
    : await query(
        `SELECT * FROM skill_versions
         WHERE skill_name = $1 AND approved = TRUE AND rolled_back = FALSE
         ORDER BY version DESC LIMIT 1`,
        [skillName],
      );
  return result.rows[0] ?? null;
}

async function loadAssignedSkills(agentId: string): Promise<AssignedSkill[]> {
  const result = await query(
    `SELECT skill_name, version, priority
     FROM agent_skills
     WHERE agent_id = $1 AND enabled = TRUE
     ORDER BY priority DESC, updated_at DESC`,
    [agentId],
  );
  return result.rows;
}

// Batch LLM call: only invoked for skills whose definition has no instructions/description field.
async function batchGenerateInstructions(skills: SkillContext[]): Promise<Map<string, string>> {
  if (!skills.length) return new Map();
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: 'For each skill below, write 1-2 sentences an AI agent can follow. Return JSON: {"skills": [{skill_name, instructions}]}',
      },
      {
        role: 'user',
        content: JSON.stringify(skills.map(s => ({ skill_name: s.skill_name, definition: s.definition }))),
      },
    ],
  });
  const raw = response.choices[0]?.message?.content ?? '{"skills":[]}';
  const parsed = JSON.parse(raw);
  const items: Array<{ skill_name: string; instructions: string }> =
    Array.isArray(parsed) ? parsed : (parsed.skills ?? []);
  return new Map(
    items
      .filter(i => typeof i?.skill_name === 'string' && typeof i?.instructions === 'string')
      .map(i => [i.skill_name, i.instructions.trim()]),
  );
}

// Get or compute embedding for an instruction string — cached by content hash.
async function getInstructionEmbedding(text: string): Promise<number[]> {
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 20);
  if (instructionEmbeddingCache.has(hash)) return instructionEmbeddingCache.get(hash)!;
  const vec = await embed(text);
  instructionEmbeddingCache.set(hash, vec);
  return vec;
}

// Filter and rank skills by semantic relevance to the task context.
// Skills below RELEVANCE_FLOOR are excluded entirely.
// Remaining are sorted by: 0.5*relevance + 0.3*(priority/maxPriority) + 0.2*success_rate
async function applyTaskContextFilter(
  skills: SkillContext[],
  taskContext: string,
  priorities: Map<string, number>,
): Promise<SkillContext[]> {
  const RELEVANCE_FLOOR = 0.25; // below this = not relevant to the current task

  const taskEmbedding = await embed(taskContext);
  const maxPriority = Math.max(1, ...Array.from(priorities.values()));

  const scored = await Promise.all(
    skills.map(async skill => {
      if (!skill.instructions) return { skill, score: 0, relevance: 0 };
      const instrEmbed = await getInstructionEmbedding(skill.instructions);
      const relevance = Math.max(0, cosineSimilarity(taskEmbedding, instrEmbed));
      const normalizedPriority = (priorities.get(skill.skill_name) ?? 0) / maxPriority;
      const score =
        0.5 * relevance +
        0.3 * normalizedPriority +
        0.2 * (skill.success_rate ?? 0);
      return { skill: { ...skill, task_relevance: relevance }, score, relevance };
    }),
  );

  return scored
    .filter(({ relevance }) => relevance >= RELEVANCE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .map(({ skill }) => skill);
}

function formatContextBlock(agentId: string, skills: SkillContext[]): string {
  const lines = [`[SKILLS: ${agentId}]`];
  for (const s of skills) {
    const pct = Math.round(Number(s.success_rate ?? 0) * 100);
    const rel = s.task_relevance !== undefined ? ` rel=${s.task_relevance.toFixed(2)}` : '';
    lines.push(`${s.skill_name}@v${s.version} (${pct}%${rel}): ${s.instructions ?? ''}`);
  }
  lines.push('[/SKILLS]');
  return lines.join('\n');
}

export async function getAgentSkills(
  agentId: string,
  opts: { task_context?: string; max_tokens?: number } = {},
): Promise<ActuatorResult> {
  const maxTokens = Math.max(0, opts.max_tokens ?? 500);
  const key = cacheKey(agentId, opts.task_context, maxTokens);
  const cached = contextCache.get(key);
  if (cached && cached.expires_at > Date.now()) return cached.result;

  const assigned = await loadAssignedSkills(agentId);
  const priorityMap = new Map(assigned.map(a => [a.skill_name, a.priority]));

  // 1. Build raw skill contexts from approved versions
  const contexts: SkillContext[] = [];
  for (const assignment of assigned) {
    const skill = await loadApprovedSkill(assignment.skill_name, assignment.version);
    if (!skill) continue;
    const definition = (skill.definition ?? {}) as Record<string, unknown>;
    const instructions = instructionFromDefinition(definition);
    contexts.push({
      skill_name: skill.skill_name,
      version: Number(skill.version),
      definition,
      success_rate: Number(skill.success_rate ?? 0),
      instructions: instructions ?? undefined,
      token_count: instructions ? tokenCount(instructions) : 0,
    });
  }

  // 2. Batch-generate instructions for any skills missing them (one LLM call, not N)
  const needsInstructions = contexts.filter(s => !s.instructions);
  if (needsInstructions.length) {
    const generated = await batchGenerateInstructions(needsInstructions).catch(() => new Map<string, string>());
    for (const skill of needsInstructions) {
      skill.instructions = generated.get(skill.skill_name) ?? JSON.stringify(skill.definition).slice(0, 200);
      skill.token_count = tokenCount(skill.instructions);
    }
  }

  // 3. Apply semantic task-context filtering if provided
  let ranked = contexts;
  if (opts.task_context?.trim()) {
    ranked = await applyTaskContextFilter(contexts, opts.task_context, priorityMap)
      .catch(() => contexts); // degrade gracefully if Voyage is unavailable
  }

  // 4. Apply token budget — greedily include highest-ranked until exhausted
  const included: SkillContext[] = [];
  let totalTokens = 0;
  for (const skill of ranked) {
    if (!skill.instructions) continue;
    const tokens = tokenCount(skill.instructions);
    if (totalTokens + tokens > maxTokens) continue;
    included.push({ ...skill, token_count: tokens });
    totalTokens += tokens;
  }

  // 5. Log activations for each included skill (skip if cache hit — already logged)
  await Promise.all(
    included.map(skill =>
      query(
        `INSERT INTO skill_activations(agent_id, skill_name, version, context)
         VALUES ($1,$2,$3,$4)`,
        [agentId, skill.skill_name, skill.version, opts.task_context ?? null],
      ).catch(() => null),
    ),
  );

  const result: ActuatorResult = {
    agent_id: agentId,
    skills: included,
    total_tokens: totalTokens,
    token_budget_used: maxTokens > 0 ? totalTokens / maxTokens : 0,
    context_block: formatContextBlock(agentId, included),
  };
  contextCache.set(key, { expires_at: Date.now() + CACHE_TTL_MS, result });
  return result;
}

export async function assignSkillToAgent(
  agentId: string,
  skillName: string,
  version?: number,
  priority = 0,
): Promise<void> {
  const skill = await loadApprovedSkill(skillName, version);
  if (!skill) throw new Error('skill_not_found_or_not_approved');
  await query(
    `INSERT INTO agent_skills(agent_id, skill_name, version, enabled, priority)
     VALUES ($1,$2,$3,TRUE,$4)
     ON CONFLICT (agent_id, skill_name) DO UPDATE
       SET version = EXCLUDED.version, enabled = TRUE,
           priority = EXCLUDED.priority, updated_at = NOW()`,
    [agentId, skillName, skill.version, priority],
  );
  invalidateAgentSkillCache(agentId);
}

export async function removeSkillFromAgent(agentId: string, skillName: string): Promise<void> {
  await query(
    `UPDATE agent_skills SET enabled = FALSE, updated_at = NOW()
     WHERE agent_id = $1 AND skill_name = $2`,
    [agentId, skillName],
  );
  invalidateAgentSkillCache(agentId);
}

export async function getAgentSkillSummary(agentId: string) {
  const result = await query(
    `SELECT ask.skill_name, ask.version, ask.enabled, ask.priority,
            COALESCE(sv.success_rate, 0) AS success_rate,
            la.last_activated
     FROM agent_skills ask
     LEFT JOIN skill_versions sv
       ON sv.skill_name = ask.skill_name AND sv.version = ask.version
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS last_activated
       FROM skill_activations sa
       WHERE sa.agent_id = ask.agent_id AND sa.skill_name = ask.skill_name
     ) la ON TRUE
     WHERE ask.agent_id = $1
     ORDER BY ask.priority DESC, ask.updated_at DESC`,
    [agentId],
  );
  return { skills: result.rows };
}

export async function recordSkillOutcome(
  agentId: string,
  skillName: string,
  success: boolean,
  feedback?: string,
): Promise<void> {
  const updated = await trackOutcome(agentId, skillName, success, feedback);
  await appendAudit('skill_outcome_recorded', 'skill', skillName, agentId, { success, feedback });

  const regressions = await detectRegressions(agentId);
  const regression = regressions.find((r: any) => r.skill_name === skillName);
  if (regression) {
    const current = await loadApprovedSkill(skillName);
    if (current) {
      await proposeSkillUpdate(
        skillName,
        current.definition ?? {},
        'Auto-proposed: regression detected',
        'actuator',
      );
      await appendAudit('skill_update_auto_proposed', 'skill', skillName, 'actuator', {
        agent_id: agentId,
        recent_rate: regression.recent_rate,
        prior_rate:  regression.prior_rate,
        current_version: current.version,
        updated_success_rate: updated?.success_rate,
      });
    }
  }
}

export async function getSkillActivations(agentId: string, limit = 20) {
  const result = await query(
    `SELECT * FROM skill_activations
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [agentId, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}
