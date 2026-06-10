import { query } from '../db/client.js';
import { embed } from '../services/embed.js';
import { detectContradictions } from './contradiction.js';
import {
  ensureMemoryQualitySchema,
  memoryKey,
  rowToMemoryRecord,
  toDbImportance,
  toLegacyMemoryType,
  type MemoryRecord,
  type MemoryRevision,
} from './types.js';

/** Searches for duplicates and either creates a new memory or merges into the closest existing record. */
export async function deduplicateBeforeStore(candidate: MemoryRecord): Promise<'created' | 'merged'> {
  await ensureMemoryQualitySchema();
  const embedding = await embed(candidate.content);
  const duplicate = await findNearest(candidate, embedding, 0.90);

  if (duplicate) {
    await mergeMemory(duplicate, candidate, embedding);
    return 'merged';
  }

  const created = await insertMemory(candidate, embedding);
  await detectContradictions({ ...candidate, id: created.id });
  return 'created';
}

/** Inserts a memory using the current OpenClaw memory table and metadata extensions. */
export async function insertMemory(candidate: MemoryRecord, embedding?: number[]): Promise<MemoryRecord> {
  await ensureMemoryQualitySchema();
  const vector = embedding ?? await embed(candidate.content);
  const result = await query(
    `INSERT INTO memories(memory_type, key, content, embedding, importance, confidence, source, tags, metadata)
     VALUES ($1,$2,$3,$4::vector,$5,$6,$7,$8::text[],$9::jsonb)
     RETURNING *`,
    [
      toLegacyMemoryType(candidate.category),
      memoryKey(candidate.category, candidate.content),
      candidate.content,
      vectorLiteral(vector),
      toDbImportance(candidate.importance),
      candidate.confidence,
      candidate.source,
      candidate.tags,
      JSON.stringify(recordMetadata(candidate)),
    ],
  );
  return rowToMemoryRecord(result.rows[0]);
}

/** Updates an existing memory with stronger merged facts and appends revision history. */
export async function mergeMemory(existing: MemoryRecord, candidate: MemoryRecord, embedding?: number[]): Promise<MemoryRecord> {
  const revision: MemoryRevision = {
    id: candidate.id,
    content: candidate.content,
    updatedAt: new Date(),
    source: candidate.source,
    confidence: candidate.confidence,
    reason: 'semantic_duplicate_merge',
  };
  const merged: MemoryRecord = {
    ...existing,
    content: chooseBetterContent(existing, candidate),
    importance: Math.max(existing.importance, candidate.importance),
    confidence: Math.min(1, Math.max(existing.confidence, candidate.confidence) + 0.03),
    source: mergeSources(existing.source, candidate.source),
    updatedAt: new Date(),
    tags: Array.from(new Set([...existing.tags, ...candidate.tags])),
    graphEdges: Array.from(new Set([...existing.graphEdges, ...candidate.graphEdges])),
    revisionHistory: [...existing.revisionHistory, revision],
  };
  const vector = embedding ?? await embed(merged.content);
  const result = await query(
    `UPDATE memories
     SET content = $2,
         embedding = $3::vector,
         importance = $4,
         confidence = $5,
         source = $6,
         tags = $7::text[],
         metadata = COALESCE(metadata, '{}') || $8::jsonb,
         updated_at = NOW(),
         recency = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      existing.id,
      merged.content,
      vectorLiteral(vector),
      toDbImportance(merged.importance),
      merged.confidence,
      merged.source,
      merged.tags,
      JSON.stringify(recordMetadata(merged)),
    ],
  );
  return rowToMemoryRecord(result.rows[0]);
}

async function findNearest(candidate: MemoryRecord, embedding: number[], threshold: number): Promise<MemoryRecord | null> {
  const result = await query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS relevance
     FROM memories
     WHERE superseded_by IS NULL
       AND memory_type != 'archived'
       AND embedding IS NOT NULL
       AND COALESCE(metadata->>'category', '') = $2
     ORDER BY relevance DESC
     LIMIT 1`,
    [vectorLiteral(embedding), candidate.category],
  );
  const row = result.rows[0];
  if (!row || Number(row.relevance) <= threshold) return null;
  return rowToMemoryRecord(row);
}

function chooseBetterContent(existing: MemoryRecord, candidate: MemoryRecord): string {
  if (candidate.confidence > existing.confidence + 0.1) return candidate.content;
  if (candidate.importance > existing.importance && candidate.content.length <= existing.content.length * 1.2) return candidate.content;
  return existing.content.length <= candidate.content.length ? existing.content : candidate.content;
}

function mergeSources(a: string, b: string): string {
  return Array.from(new Set([a, b].flatMap((source) => source.split(',').map((item) => item.trim())).filter(Boolean))).join(', ');
}

function recordMetadata(record: MemoryRecord): Record<string, unknown> {
  return {
    category: record.category,
    expiresAt: record.expiresAt?.toISOString(),
    graphEdges: record.graphEdges,
    revisionHistory: record.revisionHistory,
    source: record.source,
  };
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
