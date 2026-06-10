import { query } from '../db/client.js';
import { embed } from '../services/embed.js';
import { successfulMemoryCategories } from './agent-profile.js';
import { buildScoreBreakdown, calculateRetrievalScore, categoryBoost } from './confidence.js';
import { MemoryGraph } from './graph.js';
import {
  ensureMemoryQualitySchema,
  rowToMemoryRecord,
  type MemoryCategory,
  type MemoryRecord,
  type RetrievedMemoryRecord,
  type RetrievalContext,
} from './types.js';

interface Candidate {
  memory: MemoryRecord;
  relevance: number;
  path: string[];
}

/** Retrieves memories through the quality-first ordered pipeline, using vector search only as fallback. */
export async function retrieveMemories(queryText: string, context: RetrievalContext): Promise<RetrievedMemoryRecord[]> {
  await ensureMemoryQualitySchema();
  const candidates = new Map<string, Candidate>();
  const limit = Math.min(context.limit ?? 12, 50);

  await addExact(candidates, 'active_project', context.activeProjectId ? `metadata->>'projectId' = $1` : '', context.activeProjectId, ['Active Project Memory']);
  await addExact(candidates, 'organization', context.organizationId ? `metadata->>'organizationId' = $1` : '', context.organizationId, ['Organization Memory']);
  await addCategories(candidates, ['Identity', 'Preference', 'Goal'], context, ['User Identity Memory']);
  await addCategories(candidates, ['Decision'], context, ['Decision Memory']);

  const graph = new MemoryGraph();
  for (const candidate of [...candidates.values()]) {
    const neighbors = await graph.getNeighbors(candidate.memory.id, 1);
    for (const neighbor of neighbors) {
      upsertCandidate(candidates, neighbor, 0.78, [...candidate.path, 'Graph-linked Memory']);
    }
  }

  if (candidates.size < limit) {
    await addVectorFallback(candidates, queryText, context, limit * 2);
  }

  const successfulCategories = await successfulMemoryCategories(context.agentId);
  return [...candidates.values()]
    .filter(({ memory }) => context.includeTemporary || !memory.expiresAt || memory.expiresAt > new Date())
    .filter(({ memory }) => memory.confidence >= (context.minConfidence ?? 0))
    .map(({ memory, relevance, path }) => {
      const boost = categoryBoost(memory.category, successfulCategories);
      const breakdown = buildScoreBreakdown({ relevance, confidence: memory.confidence, importance: memory.importance, agentCategoryBoost: boost });
      return {
        ...memory,
        retrievalScore: calculateRetrievalScore({ relevance, confidence: memory.confidence, importance: memory.importance, agentCategoryBoost: boost }),
        retrievalPath: path,
        scoreBreakdown: breakdown,
      };
    })
    .sort((a, b) => {
      if (a.category === 'Decision' && b.category !== 'Decision') return -1;
      if (b.category === 'Decision' && a.category !== 'Decision') return 1;
      return b.retrievalScore - a.retrievalScore;
    })
    .slice(0, limit);
}

async function addExact(candidates: Map<string, Candidate>, name: string, where: string, value: string | undefined, path: string[]): Promise<void> {
  if (!where || !value) return;
  const result = await query(
    `SELECT * FROM memories
     WHERE superseded_by IS NULL AND memory_type != 'archived' AND ${where}
     ORDER BY importance DESC, confidence DESC
     LIMIT 12`,
    [value],
  );
  for (const row of result.rows) upsertCandidate(candidates, rowToMemoryRecord(row), name === 'active_project' ? 1 : 0.94, path);
}

async function addCategories(candidates: Map<string, Candidate>, categories: MemoryCategory[], context: RetrievalContext, path: string[]): Promise<void> {
  const params: unknown[] = [categories];
  const scope: string[] = [];
  let index = 2;
  if (context.userId) {
    scope.push(`metadata->>'userId' = $${index++}`);
    params.push(context.userId);
  }
  if (context.workspaceId) {
    scope.push(`workspace_id = $${index++}`);
    params.push(context.workspaceId);
  }
  const scopeSql = scope.length ? `AND (${scope.join(' OR ')})` : '';
  const result = await query(
    `SELECT * FROM memories
     WHERE superseded_by IS NULL
       AND memory_type != 'archived'
       AND COALESCE(metadata->>'category', '') = ANY($1::text[])
       ${scopeSql}
     ORDER BY CASE WHEN COALESCE(metadata->>'category', '') = 'Decision' THEN 0 ELSE 1 END,
              importance DESC, confidence DESC, updated_at DESC
     LIMIT 20`,
    params,
  );
  for (const row of result.rows) upsertCandidate(candidates, rowToMemoryRecord(row), categories.includes('Decision') ? 1 : 0.88, path);
}

async function addVectorFallback(candidates: Map<string, Candidate>, queryText: string, context: RetrievalContext, limit: number): Promise<void> {
  const vector = await embed(queryText);
  const params: unknown[] = [vectorLiteral(vector), limit];
  const wheres = [`superseded_by IS NULL`, `memory_type != 'archived'`, `embedding IS NOT NULL`];
  let index = 3;
  if (context.workspaceId) {
    wheres.push(`workspace_id = $${index++}`);
    params.push(context.workspaceId);
  }
  const result = await query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS relevance
     FROM memories
     WHERE ${wheres.join(' AND ')}
     ORDER BY relevance DESC
     LIMIT $2`,
    params,
  );
  for (const row of result.rows) upsertCandidate(candidates, rowToMemoryRecord(row), Number(row.relevance ?? 0), ['Vector Search']);
}

function upsertCandidate(candidates: Map<string, Candidate>, memory: MemoryRecord, relevance: number, path: string[]): void {
  const existing = candidates.get(memory.id);
  if (!existing || relevance > existing.relevance) candidates.set(memory.id, { memory, relevance, path });
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
