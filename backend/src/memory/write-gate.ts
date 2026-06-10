import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import { embed } from '../services/embed.js';
import { scoreImportance, temporaryExpiry } from './scorer.js';

export type MemoryOsCategory =
  | 'identity' | 'preference' | 'project' | 'org' | 'decision' | 'governance'
  | 'repo' | 'workflow' | 'agent_profile' | 'semantic' | 'episodic' | 'conflict' | 'reflection';

export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'decision' | 'identity';

export interface WriteGateInput {
  content: string;
  org_id?: string;
  project_id?: string;
  user_id?: string;
  agent_id?: string;
  source?: string;
  category?: MemoryOsCategory;
  memory_tier?: MemoryTier;
  structured_payload?: Record<string, unknown>;
  tags?: string[];
  embedding?: number[];
  forcePermanent?: boolean;
}

export interface WriteGateResult {
  accepted: boolean;
  permanent: boolean;
  category: MemoryOsCategory;
  memory_tier: MemoryTier;
  importance_score: number;
  confidence_score: number;
  expiration_policy: string;
  expires_at?: Date;
  structured_payload: Record<string, unknown>;
  entities: Array<Record<string, unknown>>;
  relationships: Array<Record<string, unknown>>;
  should_embed: boolean;
  reasons: string[];
  normalized_content: string;
}

export interface MemoryCreateResult {
  status: 'created' | 'merged' | 'working' | 'rejected';
  memory?: Record<string, unknown>;
  gate: WriteGateResult;
  conflicts: Record<string, unknown>[];
}

const embedCategories = new Set<MemoryOsCategory>(['semantic', 'decision', 'identity', 'repo', 'governance']);

/** Classifies and scores a candidate memory before any permanent write. */
export async function runWriteGate(input: WriteGateInput): Promise<WriteGateResult> {
  const normalized = normalizeContent(input.content);
  const category = input.category ?? classifyCategory(normalized);
  const chitChat = isChitChat(normalized);
  const structured_payload = buildStructuredPayload(category, normalized, input.structured_payload);
  const importance = category === 'decision'
    ? 10
    : scoreImportance(normalized, {
      affectsFutureDecisions: ['decision', 'governance'].includes(category),
      projectCritical: category === 'project' || category === 'repo',
      organizationCritical: category === 'org' || category === 'governance',
      governanceRelated: category === 'governance',
      repositoryRelated: category === 'repo',
      agentRoleRelated: category === 'agent_profile',
      casualConversation: chitChat,
      temporaryQuestion: /\?$/.test(normalized),
      oneTimeFact: /\b(today|tomorrow|yesterday|one time|once)\b/i.test(normalized),
      lowFutureUtility: chitChat || normalized.length < 24,
    });
  const confidence = scoreConfidence(normalized, input);
  const memoryTier = input.memory_tier ?? assignTier(category, importance, chitChat);
  const permanent = input.forcePermanent === true
    ? importance >= 5 && !chitChat
    : importance >= 5 && memoryTier !== 'working' && !chitChat;
  const expiresAt = permanent ? undefined : temporaryExpiry();
  const shouldEmbed = shouldEmbedMemory(category, memoryTier, importance, permanent);
  const reasons = explainGate({ normalized, category, importance, confidence, chitChat, permanent, shouldEmbed });

  return {
    accepted: permanent || memoryTier === 'working',
    permanent,
    category,
    memory_tier: memoryTier,
    importance_score: importance,
    confidence_score: confidence,
    expiration_policy: category === 'decision' ? 'never_archive' : permanent ? 'retain_until_superseded' : 'ttl_24h',
    expires_at: expiresAt,
    structured_payload,
    entities: extractEntities(normalized),
    relationships: extractRelationships(normalized),
    should_embed: shouldEmbed,
    reasons,
    normalized_content: normalized,
  };
}

/** Runs the gate and persists an accepted memory, merging semantic duplicates above 0.90. */
export async function createMemoryThroughGate(input: WriteGateInput): Promise<MemoryCreateResult> {
  const gate = await runWriteGate(input);
  if (!gate.accepted) return { status: 'rejected', gate, conflicts: [] };

  const embedding = gate.should_embed ? (input.embedding ?? await embed(gate.normalized_content)) : undefined;
  const duplicate = embedding ? await findDuplicate(gate.category, embedding, 0.90) : null;
  if (duplicate) {
    const merged = await mergeExistingMemory(duplicate, input, gate, embedding);
    return { status: gate.permanent ? 'merged' : 'working', memory: merged, gate, conflicts: [] };
  }

  const created = await insertGatedMemory(input, gate, embedding);
  const conflicts = await createConflictsForContradictions(created, gate);
  return { status: gate.permanent ? 'created' : 'working', memory: created, gate, conflicts };
}

/** Re-runs the write gate against an existing row and updates Memory OS columns. */
export async function reprocessMemory(memoryId: string): Promise<MemoryCreateResult | null> {
  const result = await query(`SELECT * FROM memories WHERE id = $1`, [memoryId]);
  const row = result.rows[0];
  if (!row) return null;
  const gate = await runWriteGate({
    content: row.content,
    org_id: row.org_id ?? undefined,
    project_id: row.project_id ?? row.workspace_id ?? undefined,
    user_id: row.user_id ?? undefined,
    agent_id: row.agent_id ?? undefined,
    source: row.source ?? undefined,
    category: row.category ?? undefined,
    structured_payload: row.structured_payload ?? undefined,
  });
  const updated = await updateMemoryOsColumns(memoryId, gate);
  return { status: gate.permanent ? 'created' : 'working', memory: updated, gate, conflicts: [] };
}

/** Returns true when a category/tier is allowed to receive a vector embedding. */
export function shouldEmbedMemory(category: MemoryOsCategory, tier: MemoryTier, importance: number, permanent: boolean): boolean {
  if (!permanent) return false;
  if (embedCategories.has(category)) return true;
  return category === 'episodic' && tier === 'episodic' && importance >= 7;
}

function classifyCategory(content: string): MemoryOsCategory {
  if (/\b(decided|decision|approved|chose|chosen|because)\b/i.test(content)) return 'decision';
  if (/\b(governance|proposal|vote|policy|approval|quorum)\b/i.test(content)) return 'governance';
  if (/\b(repo|repository|github|branch|commit|pull request|pr #?\d*)\b/i.test(content)) return 'repo';
  if (/\b(agent|worker|tool success|failed action|preferred tool)\b/i.test(content)) return 'agent_profile';
  if (/\b(prefers|likes|dislikes|always wants|never wants)\b/i.test(content)) return 'preference';
  if (/\b(identity|name is|timezone|email|role is)\b/i.test(content)) return 'identity';
  if (/\b(project|milestone|roadmap|sprint)\b/i.test(content)) return 'project';
  if (/\b(org|organization|company|team)\b/i.test(content)) return 'org';
  if (/\b(workflow|process|runbook|procedure)\b/i.test(content)) return 'workflow';
  return content.length > 160 ? 'semantic' : 'episodic';
}

function assignTier(category: MemoryOsCategory, importance: number, chitChat: boolean): MemoryTier {
  if (chitChat || importance < 5) return 'working';
  if (category === 'decision') return 'decision';
  if (category === 'identity' || category === 'preference') return 'identity';
  if (category === 'episodic') return 'episodic';
  return 'semantic';
}

function buildStructuredPayload(category: MemoryOsCategory, content: string, supplied?: Record<string, unknown>): Record<string, unknown> {
  if (category === 'decision') {
    return {
      decision: String(supplied?.decision ?? content),
      reasoning: String(supplied?.reasoning ?? extractAfter(content, 'because') ?? ''),
      alternatives: Array.isArray(supplied?.alternatives) ? supplied.alternatives : [],
      chosen_because: String(supplied?.chosen_because ?? extractAfter(content, 'because') ?? ''),
      rejected_because: String(supplied?.rejected_because ?? ''),
      approvers: Array.isArray(supplied?.approvers) ? supplied.approvers : [],
      timestamp: String(supplied?.timestamp ?? new Date().toISOString()),
    };
  }
  if (category === 'governance') {
    return {
      proposal: String(supplied?.proposal ?? content),
      proposed_by: String(supplied?.proposed_by ?? ''),
      votes: Array.isArray(supplied?.votes) ? supplied.votes : [],
      outcome: String(supplied?.outcome ?? ''),
      reasoning: String(supplied?.reasoning ?? extractAfter(content, 'because') ?? ''),
      affected_entities: Array.isArray(supplied?.affected_entities) ? supplied.affected_entities : [],
      timestamp: String(supplied?.timestamp ?? new Date().toISOString()),
    };
  }
  return supplied ?? {};
}

function extractEntities(content: string): Array<Record<string, unknown>> {
  const entities = new Map<string, Record<string, unknown>>();
  for (const match of content.matchAll(/\b([A-Z][A-Za-z0-9_-]{2,}(?:\s+[A-Z][A-Za-z0-9_-]{2,})*)\b/g)) {
    entities.set(match[1], { name: match[1], type: 'proper_noun' });
  }
  for (const match of content.matchAll(/\b(?:github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/g)) {
    entities.set(match[1], { name: match[1], type: 'repository' });
  }
  return [...entities.values()].slice(0, 25);
}

function extractRelationships(content: string): Array<Record<string, unknown>> {
  const relationships: Array<Record<string, unknown>> = [];
  const owns = content.match(/\b(.+?)\s+owns\s+(.+?)(?:\.|$)/i);
  if (owns) relationships.push({ from: owns[1].trim(), relation: 'owns', to: owns[2].trim() });
  const assigned = content.match(/\b(.+?)\s+(?:assigned to|works on)\s+(.+?)(?:\.|$)/i);
  if (assigned) relationships.push({ from: assigned[1].trim(), relation: 'assigned_to', to: assigned[2].trim() });
  const repo = content.match(/\b(.+?)\s+(?:uses|has repo|repository)\s+(.+?)(?:\.|$)/i);
  if (repo) relationships.push({ from: repo[1].trim(), relation: 'has_repo', to: repo[2].trim() });
  return relationships.slice(0, 20);
}

async function insertGatedMemory(input: WriteGateInput, gate: WriteGateResult, embedding?: number[]): Promise<Record<string, unknown>> {
  const id = randomUUID();
  const result = await query(
    `INSERT INTO memories(
       id, memory_type, key, content, embedding, importance, confidence, source, tags,
       org_id, project_id, user_id, agent_id, category, memory_tier, importance_score,
       confidence_score, structured_payload, entities, relationships, expires_at,
       expiration_policy, metadata
     )
     VALUES ($1,$2,$3,$4,$5::vector,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23::jsonb)
     RETURNING *`,
    [
      id,
      legacyType(gate.category),
      `${gate.category}:${gate.normalized_content.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
      gate.normalized_content,
      embedding ? vectorLiteral(embedding) : null,
      gate.importance_score / 10,
      gate.confidence_score,
      input.source ?? 'memory.write-gate',
      input.tags ?? [],
      input.org_id ?? null,
      input.project_id ?? null,
      input.user_id ?? null,
      input.agent_id ?? null,
      gate.category,
      gate.memory_tier,
      gate.importance_score,
      gate.confidence_score,
      JSON.stringify(gate.structured_payload),
      JSON.stringify(gate.entities),
      JSON.stringify(gate.relationships),
      gate.expires_at ?? null,
      gate.expiration_policy,
      JSON.stringify({ category: toQualityCategory(gate.category), memoryOs: true }),
    ],
  );
  return result.rows[0];
}

async function mergeExistingMemory(existing: any, input: WriteGateInput, gate: WriteGateResult, embedding?: number[]): Promise<Record<string, unknown>> {
  await query(
    `INSERT INTO memory_versions(memory_id, version, content, structured_payload, importance_score, confidence_score, reason)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      existing.id,
      existing.version ?? 1,
      existing.content,
      JSON.stringify(existing.structured_payload ?? {}),
      existing.importance_score ?? Math.round(Number(existing.importance ?? 0.5) * 10),
      existing.confidence_score ?? Number(existing.confidence ?? 0.8),
      'semantic_duplicate_merge',
    ],
  );
  const result = await query(
    `UPDATE memories
     SET content = $2,
         embedding = COALESCE($3::vector, embedding),
         importance = GREATEST(importance, $4),
         confidence = GREATEST(confidence, $5),
         importance_score = GREATEST(COALESCE(importance_score, 1), $6),
         confidence_score = GREATEST(COALESCE(confidence_score, 0), $7),
         structured_payload = COALESCE(structured_payload, '{}') || $8::jsonb,
         entities = $9::jsonb,
         relationships = $10::jsonb,
         source = concat_ws(', ', NULLIF(source, ''), $11::text),
         version = COALESCE(version, 1) + 1,
         updated_at = NOW(),
         recency = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      existing.id,
      chooseContent(existing.content, gate.normalized_content, existing.confidence_score ?? existing.confidence, gate.confidence_score),
      embedding ? vectorLiteral(embedding) : null,
      gate.importance_score / 10,
      gate.confidence_score,
      gate.importance_score,
      gate.confidence_score,
      JSON.stringify(gate.structured_payload),
      JSON.stringify(gate.entities),
      JSON.stringify(gate.relationships),
      input.source ?? 'memory.write-gate',
    ],
  );
  return result.rows[0];
}

async function updateMemoryOsColumns(memoryId: string, gate: WriteGateResult): Promise<Record<string, unknown>> {
  const result = await query(
    `UPDATE memories
     SET category = $2, memory_tier = $3, importance_score = $4, confidence_score = $5,
         structured_payload = $6::jsonb, entities = $7::jsonb, relationships = $8::jsonb,
         expires_at = $9, expiration_policy = $10, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      memoryId,
      gate.category,
      gate.memory_tier,
      gate.importance_score,
      gate.confidence_score,
      JSON.stringify(gate.structured_payload),
      JSON.stringify(gate.entities),
      JSON.stringify(gate.relationships),
      gate.expires_at ?? null,
      gate.expiration_policy,
    ],
  );
  return result.rows[0];
}

async function findDuplicate(category: MemoryOsCategory, embedding: number[], threshold: number): Promise<Record<string, unknown> | null> {
  const result = await query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM memories
     WHERE superseded_by IS NULL
       AND memory_type != 'archived'
       AND embedding IS NOT NULL
       AND category = $2
     ORDER BY similarity DESC
     LIMIT 1`,
    [vectorLiteral(embedding), category],
  );
  const row = result.rows[0];
  return row && Number(row.similarity) > threshold ? row : null;
}

async function createConflictsForContradictions(created: Record<string, unknown>, gate: WriteGateResult): Promise<Record<string, unknown>[]> {
  if (!/\b(no longer|not|never|instead|changed|replaces|deprecates?)\b/i.test(gate.normalized_content)) return [];
  const result = await query(
    `SELECT *
     FROM memories
     WHERE id != $1
       AND memory_type != 'archived'
       AND superseded_by IS NULL
       AND category = $2
       AND (
         lower(content) LIKE '%' || lower(split_part($3, ' ', 1)) || '%'
         OR project_id IS NOT DISTINCT FROM $4
       )
     LIMIT 10`,
    [created.id, gate.category, gate.normalized_content, created.project_id ?? null],
  );
  const conflicts: Record<string, unknown>[] = [];
  for (const old of result.rows) {
    if (!sharesSignificantTerm(old.content, gate.normalized_content)) continue;
    const inserted = await query(
      `INSERT INTO memory_conflicts(
         old_memory_id, new_memory_id, conflict_type, old_claim, new_claim,
         old_confidence, new_confidence, resolution_status, explanation
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'unresolved',$8)
       RETURNING *`,
      [
        old.id,
        created.id,
        'semantic_claim_conflict',
        old.content,
        gate.normalized_content,
        old.confidence_score ?? old.confidence,
        gate.confidence_score,
        'New claim appears to negate or replace an existing claim.',
      ],
    );
    conflicts.push(inserted.rows[0]);
  }
  return conflicts;
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
}

function isChitChat(content: string): boolean {
  return /^(hi|hello|hey|lol|haha|thanks|thank you|cool|nice|ok|okay)[!. ]*$/i.test(content)
    || /\b(joke|funny|lol|haha|chit chat)\b/i.test(content);
}

function scoreConfidence(content: string, input: WriteGateInput): number {
  let confidence = input.source ? 0.78 : 0.62;
  if (input.structured_payload && Object.keys(input.structured_payload).length > 0) confidence += 0.1;
  if (/\b(decided|approved|confirmed|source|commit|PR|issue)\b/i.test(content)) confidence += 0.08;
  if (/\b(maybe|probably|might|guess|unsure)\b/i.test(content)) confidence -= 0.25;
  return Math.min(1, Math.max(0.1, Number(confidence.toFixed(2))));
}

function explainGate(input: {
  normalized: string;
  category: MemoryOsCategory;
  importance: number;
  confidence: number;
  chitChat: boolean;
  permanent: boolean;
  shouldEmbed: boolean;
}): string[] {
  const reasons = [`classified:${input.category}`, `importance:${input.importance}`, `confidence:${input.confidence}`];
  if (input.chitChat) reasons.push('chit_chat_or_low_future_utility');
  if (!input.permanent) reasons.push('not_permanent_below_quality_bar_or_working_ttl');
  if (!input.shouldEmbed) reasons.push('embedding_skipped_by_policy');
  return reasons;
}

function extractAfter(content: string, marker: string): string | undefined {
  const index = content.toLowerCase().indexOf(marker);
  return index >= 0 ? content.slice(index + marker.length).trim().replace(/^[,: -]+/, '') : undefined;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function legacyType(category: MemoryOsCategory): string {
  if (category === 'decision') return 'decision';
  if (category === 'repo' || category === 'project') return 'project';
  if (category === 'org' || category === 'governance') return 'org';
  if (category === 'agent_profile') return 'agent';
  if (category === 'identity' || category === 'preference') return 'user';
  return 'workspace';
}

function toQualityCategory(category: MemoryOsCategory): string {
  const map: Record<MemoryOsCategory, string> = {
    identity: 'Identity',
    preference: 'Preference',
    project: 'Project',
    org: 'Organization',
    decision: 'Decision',
    governance: 'Organization',
    repo: 'Repository',
    workflow: 'Skill',
    agent_profile: 'Agent',
    semantic: 'ConversationSummary',
    episodic: 'ConversationSummary',
    conflict: 'TemporaryContext',
    reflection: 'ConversationSummary',
  };
  return map[category];
}

function chooseContent(existing: string, incoming: string, oldConfidence: number, newConfidence: number): string {
  if (newConfidence > oldConfidence + 0.1) return incoming;
  return existing.length <= incoming.length ? existing : incoming;
}

function sharesSignificantTerm(a: string, b: string): boolean {
  const terms = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((term) => term.length > 4));
  return b.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).some((term) => terms.has(term));
}
