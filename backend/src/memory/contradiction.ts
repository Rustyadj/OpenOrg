import { query } from '../db/client.js';
import { embed } from '../services/embed.js';
import { ensureMemoryQualitySchema, rowToMemoryRecord, type MemoryRecord } from './types.js';

export interface ConflictRecord {
  id: string;
  existingMemoryId: string;
  newMemoryId: string;
  existingConfidence: number;
  newConfidence: number;
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: 'kept_existing' | 'replaced' | 'merged' | 'both_kept';
}

const negationPattern = /\b(no longer|not|never|instead of|rather than|replaces|changed from|changed to|stopped|disabled|deprecates?)\b/i;

/** Detects likely contradictions without overwriting either memory. */
export async function detectContradictions(candidate: MemoryRecord): Promise<ConflictRecord[]> {
  await ensureMemoryQualitySchema();
  const vector = await embed(candidate.content);
  const rows = await query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS relevance
     FROM memories
     WHERE superseded_by IS NULL
       AND memory_type != 'archived'
       AND id != $2
       AND embedding IS NOT NULL
       AND COALESCE(metadata->>'category', '') = $3
     ORDER BY relevance DESC
     LIMIT 10`,
    [vectorLiteral(vector), candidate.id, candidate.category],
  );

  const conflicts: ConflictRecord[] = [];
  for (const row of rows.rows) {
    const existing = rowToMemoryRecord(row);
    const similarity = Number(row.relevance ?? 0);
    if (similarity < 0.72) continue;
    if (!isContradictory(existing.content, candidate.content)) continue;
    conflicts.push(await createConflict(existing, candidate));
  }
  return conflicts;
}

/** Persists a conflict for human resolution in the Memory Audit UI. */
export async function createConflict(existing: MemoryRecord, incoming: MemoryRecord): Promise<ConflictRecord> {
  await ensureMemoryQualitySchema();
  const result = await query(
    `INSERT INTO memory_conflicts(existing_memory_id, new_memory_id, existing_confidence, new_confidence, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (existing_memory_id, new_memory_id)
     DO UPDATE SET existing_confidence = EXCLUDED.existing_confidence, new_confidence = EXCLUDED.new_confidence
     RETURNING *`,
    [
      existing.id,
      incoming.id,
      existing.confidence,
      incoming.confidence,
      JSON.stringify({ existingContent: existing.content, newContent: incoming.content }),
    ],
  );
  return rowToConflict(result.rows[0]);
}

/** Lists unresolved conflicts for review. */
export async function listUnresolvedConflicts(): Promise<ConflictRecord[]> {
  await ensureMemoryQualitySchema();
  const result = await query(`SELECT * FROM memory_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC`);
  return result.rows.map(rowToConflict);
}

/** Marks a conflict as resolved without deleting either memory. */
export async function resolveConflict(id: string, resolution: ConflictRecord['resolution']): Promise<ConflictRecord | null> {
  await ensureMemoryQualitySchema();
  const result = await query(
    `UPDATE memory_conflicts SET resolution = $2, resolved_at = NOW() WHERE id = $1 RETURNING *`,
    [id, resolution],
  );
  return result.rows[0] ? rowToConflict(result.rows[0]) : null;
}

/** Heuristically checks whether two memory statements conflict. */
export function isContradictory(existing: string, incoming: string): boolean {
  const a = existing.toLowerCase();
  const b = incoming.toLowerCase();
  if (!negationPattern.test(a) && !negationPattern.test(b)) return false;
  const sharedTerms = significantTerms(a).filter((term) => significantTerms(b).includes(term));
  return sharedTerms.length >= 2;
}

function significantTerms(text: string): string[] {
  return text
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 4 && !['about', 'which', 'their', 'there', 'memory'].includes(term));
}

function rowToConflict(row: any): ConflictRecord {
  return {
    id: row.id,
    existingMemoryId: row.existing_memory_id,
    newMemoryId: row.new_memory_id,
    existingConfidence: Number(row.existing_confidence),
    newConfidence: Number(row.new_confidence),
    detectedAt: new Date(row.detected_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolution: row.resolution ?? undefined,
  };
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
