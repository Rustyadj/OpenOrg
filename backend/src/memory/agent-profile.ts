import { query } from '../db/client.js';
import { ensureMemoryQualitySchema, type MemoryCategory } from './types.js';

export interface ActionRecord {
  actionId: string;
  categoryUsed?: MemoryCategory;
  tool: string;
  description: string;
  at: Date;
}

export interface PerformanceEntry {
  at: Date;
  successRate: number;
  latencyMs?: number;
  notes?: string;
}

export interface AgentProfile {
  agentId: string;
  expertise: string[];
  successfulActions: ActionRecord[];
  failedActions: ActionRecord[];
  preferredTools: string[];
  performanceHistory: PerformanceEntry[];
}

/** Loads an agent profile, returning an empty durable profile when none exists yet. */
export async function getAgentProfile(agentId: string): Promise<AgentProfile> {
  await ensureMemoryQualitySchema();
  const result = await query(`SELECT profile FROM agent_profiles WHERE agent_id = $1`, [agentId]);
  if (!result.rows[0]) return emptyProfile(agentId);
  return normalizeProfile(agentId, result.rows[0].profile);
}

/** Upserts the complete profile for an agent. */
export async function saveAgentProfile(profile: AgentProfile): Promise<AgentProfile> {
  await ensureMemoryQualitySchema();
  const normalized = normalizeProfile(profile.agentId, profile);
  await query(
    `INSERT INTO agent_profiles(agent_id, profile)
     VALUES ($1,$2::jsonb)
     ON CONFLICT (agent_id)
     DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
    [normalized.agentId, JSON.stringify(serializeProfile(normalized))],
  );
  return normalized;
}

/** Records an agent action outcome and updates preferred tool/expertise signals. */
export async function recordAgentAction(agentId: string, action: ActionRecord, success: boolean): Promise<AgentProfile> {
  const profile = await getAgentProfile(agentId);
  const next: AgentProfile = {
    ...profile,
    successfulActions: success ? [...profile.successfulActions, action].slice(-200) : profile.successfulActions,
    failedActions: success ? profile.failedActions : [...profile.failedActions, action].slice(-200),
    preferredTools: success ? topTools([...profile.successfulActions, action]) : profile.preferredTools,
  };
  return saveAgentProfile(next);
}

/** Returns memory categories this agent has successfully used before. */
export async function successfulMemoryCategories(agentId?: string): Promise<MemoryCategory[]> {
  if (!agentId) return [];
  const profile = await getAgentProfile(agentId);
  return profile.successfulActions.flatMap((action) => action.categoryUsed ? [action.categoryUsed] : []);
}

function emptyProfile(agentId: string): AgentProfile {
  return { agentId, expertise: [], successfulActions: [], failedActions: [], preferredTools: [], performanceHistory: [] };
}

function normalizeProfile(agentId: string, value: unknown): AgentProfile {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    agentId,
    expertise: asStrings(raw.expertise),
    successfulActions: asActions(raw.successfulActions),
    failedActions: asActions(raw.failedActions),
    preferredTools: asStrings(raw.preferredTools),
    performanceHistory: asPerformance(raw.performanceHistory),
  };
}

function serializeProfile(profile: AgentProfile): Record<string, unknown> {
  return {
    ...profile,
    successfulActions: profile.successfulActions.map((action) => ({ ...action, at: action.at.toISOString() })),
    failedActions: profile.failedActions.map((action) => ({ ...action, at: action.at.toISOString() })),
    performanceHistory: profile.performanceHistory.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
  };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asActions(value: unknown): ActionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    return [{
      actionId: String(raw.actionId ?? ''),
      categoryUsed: raw.categoryUsed as MemoryCategory | undefined,
      tool: String(raw.tool ?? ''),
      description: String(raw.description ?? ''),
      at: new Date(String(raw.at ?? new Date().toISOString())),
    }];
  });
}

function asPerformance(value: unknown): PerformanceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    return [{
      at: new Date(String(raw.at ?? new Date().toISOString())),
      successRate: Number(raw.successRate ?? 0),
      latencyMs: raw.latencyMs === undefined ? undefined : Number(raw.latencyMs),
      notes: raw.notes === undefined ? undefined : String(raw.notes),
    }];
  });
}

function topTools(actions: ActionRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const action of actions) counts.set(action.tool, (counts.get(action.tool) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tool]) => tool);
}
