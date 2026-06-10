import { query } from '../db/client.js';

export type MemoryCategory =
  | 'Identity' | 'Preference' | 'Goal' | 'Project' | 'Organization'
  | 'Agent' | 'Relationship' | 'Decision' | 'Task' | 'Skill'
  | 'Repository' | 'ConversationSummary' | 'TemporaryContext';

export interface MemoryRevision {
  id: string;
  content: string;
  updatedAt: Date;
  source: string;
  confidence: number;
  reason: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  tags: string[];
  graphEdges: string[];
  revisionHistory: MemoryRevision[];
}

export interface RetrievedMemoryRecord extends MemoryRecord {
  retrievalScore: number;
  retrievalPath: string[];
  scoreBreakdown: RetrievalScoreBreakdown;
}

export interface RetrievalScoreBreakdown {
  relevance: number;
  confidence: number;
  importanceFactor: number;
  agentCategoryBoost: number;
  finalScore: number;
}

export interface ScoringContext {
  repeated?: boolean;
  affectsFutureDecisions?: boolean;
  projectCritical?: boolean;
  organizationCritical?: boolean;
  governanceRelated?: boolean;
  repositoryRelated?: boolean;
  agentRoleRelated?: boolean;
  casualConversation?: boolean;
  temporaryQuestion?: boolean;
  oneTimeFact?: boolean;
  lowFutureUtility?: boolean;
}

export interface RetrievalContext {
  activeProjectId?: string;
  organizationId?: string;
  userId?: string;
  agentId?: string;
  workspaceId?: string;
  limit?: number;
  minConfidence?: number;
  includeTemporary?: boolean;
}

export interface RepoMemory extends MemoryRecord {
  category: 'Repository';
  repoUrl: string;
  architectureOverview: string;
  services: string[];
  agentsOrWorkers: string[];
  workflows: string[];
  databaseSchemaSummary: string;
  roadmapItems: string[];
  keyDecisions: string[];
}

export interface ReflectionLog {
  runAt: Date;
  memoriesMerged: number;
  confidenceUpdates: number;
  contradictionsFound: number;
  archived: number;
}

export interface MemoryStoreRow {
  id: string;
  memory_type: string;
  key: string;
  content: string;
  importance: number;
  confidence: number;
  source: string | null;
  workspace_id: string | null;
  agent_id: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  score?: number;
  relevance?: number;
}

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  'Identity', 'Preference', 'Goal', 'Project', 'Organization',
  'Agent', 'Relationship', 'Decision', 'Task', 'Skill',
  'Repository', 'ConversationSummary', 'TemporaryContext',
] as const;

const categoryToLegacyType: Record<MemoryCategory, string> = {
  Identity: 'user',
  Preference: 'user',
  Goal: 'user',
  Project: 'project',
  Organization: 'org',
  Agent: 'agent',
  Relationship: 'workspace',
  Decision: 'decision',
  Task: 'workspace',
  Skill: 'procedural',
  Repository: 'project',
  ConversationSummary: 'workspace',
  TemporaryContext: 'workspace',
};

/** Converts a quality-system category into the legacy database memory_type enum. */
export function toLegacyMemoryType(category: MemoryCategory): string {
  return categoryToLegacyType[category];
}

/** Converts 1-10 quality importance into the current database's 0-1 importance scale. */
export function toDbImportance(importance: number): number {
  return Math.min(1, Math.max(0, importance / 10));
}

/** Converts current database importance into the public 1-10 quality scale. */
export function fromDbImportance(importance: number): number {
  if (importance <= 1) return Math.max(1, Math.round(importance * 10));
  return Math.min(10, Math.max(1, Math.round(importance)));
}

/** Builds a stable memory key from category and content when callers do not supply one. */
export function memoryKey(category: MemoryCategory, content: string): string {
  const normalized = content.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 96);
  return `${category}:${normalized || 'memory'}`;
}

/** Converts a database row from the legacy memory table into a MemoryRecord. */
export function rowToMemoryRecord(row: MemoryStoreRow): MemoryRecord {
  const metadata = row.metadata ?? {};
  const category = parseCategory(metadata.category, row.memory_type);
  return {
    id: row.id,
    content: row.content,
    category,
    importance: fromDbImportance(Number(row.importance ?? 0.5)),
    confidence: Number(row.confidence ?? 0.8),
    source: row.source ?? String(metadata.source ?? 'unknown'),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: parseOptionalDate(metadata.expiresAt),
    tags: row.tags ?? [],
    graphEdges: asStringArray(metadata.graphEdges),
    revisionHistory: asRevisionHistory(metadata.revisionHistory),
  };
}

/** Ensures support tables required by the quality modules exist. */
export async function ensureMemoryQualitySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS memory_graph_edges (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      from_id UUID NOT NULL,
      to_id UUID NOT NULL,
      relation_label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(from_id, to_id, relation_label)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_memory_graph_edges_from ON memory_graph_edges(from_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_memory_graph_edges_to ON memory_graph_edges(to_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS memory_conflicts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      existing_memory_id UUID NOT NULL,
      new_memory_id UUID NOT NULL,
      existing_confidence FLOAT NOT NULL,
      new_confidence FLOAT NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolution TEXT CHECK (resolution IN ('kept_existing','replaced','merged','both_kept')),
      metadata JSONB NOT NULL DEFAULT '{}',
      UNIQUE(existing_memory_id, new_memory_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS memory_reflection_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      memories_merged INT NOT NULL DEFAULT 0,
      confidence_updates INT NOT NULL DEFAULT 0,
      contradictions_found INT NOT NULL DEFAULT 0,
      archived INT NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_id TEXT PRIMARY KEY,
      profile JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function parseCategory(value: unknown, legacyType: string): MemoryCategory {
  if (typeof value === 'string' && MEMORY_CATEGORIES.includes(value as MemoryCategory)) {
    return value as MemoryCategory;
  }
  if (legacyType === 'decision') return 'Decision';
  if (legacyType === 'project') return 'Project';
  if (legacyType === 'org') return 'Organization';
  if (legacyType === 'agent') return 'Agent';
  if (legacyType === 'procedural') return 'Skill';
  return 'ConversationSummary';
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRevisionHistory(value: unknown): MemoryRevision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    return [{
      id: String(candidate.id ?? ''),
      content: String(candidate.content ?? ''),
      updatedAt: new Date(String(candidate.updatedAt ?? new Date().toISOString())),
      source: String(candidate.source ?? 'unknown'),
      confidence: Number(candidate.confidence ?? 0.5),
      reason: String(candidate.reason ?? 'revision'),
    }];
  });
}
