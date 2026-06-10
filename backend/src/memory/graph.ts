import { query } from '../db/client.js';
import { ensureMemoryQualitySchema, rowToMemoryRecord, type MemoryRecord } from './types.js';

/** Memory graph backed by Postgres edges for deterministic retrieval expansion. */
export class MemoryGraph {
  /** Adds or refreshes a labeled directed edge between two memories. */
  async addEdge(fromId: string, toId: string, relationLabel: string): Promise<void> {
    await ensureMemoryQualitySchema();
    await query(
      `INSERT INTO memory_graph_edges(from_id, to_id, relation_label)
       VALUES ($1,$2,$3)
       ON CONFLICT (from_id, to_id, relation_label)
       DO UPDATE SET updated_at = NOW()`,
      [fromId, toId, relationLabel],
    );
    await appendEdgeMetadata(fromId, toId);
  }

  /** Returns graph neighbors up to the requested depth. */
  async getNeighbors(id: string, depth = 1): Promise<MemoryRecord[]> {
    await ensureMemoryQualitySchema();
    const boundedDepth = Math.min(Math.max(depth, 1), 4);
    const result = await query(
      `WITH RECURSIVE walk(id, depth) AS (
         SELECT $1::uuid, 0
         UNION
         SELECT CASE WHEN e.from_id = walk.id THEN e.to_id ELSE e.from_id END, walk.depth + 1
         FROM walk
         JOIN memory_graph_edges e ON e.from_id = walk.id OR e.to_id = walk.id
         WHERE walk.depth < $2
       )
       SELECT m.*
       FROM walk
       JOIN memories m ON m.id = walk.id
       WHERE walk.depth > 0
         AND m.superseded_by IS NULL
         AND m.memory_type != 'archived'`,
      [id, boundedDepth],
    );
    return result.rows.map(rowToMemoryRecord);
  }

  /** Traverses every reachable memory from a root using a bounded recursive walk. */
  async traverse(rootId: string): Promise<MemoryRecord[]> {
    return this.getNeighbors(rootId, 4);
  }
}

async function appendEdgeMetadata(fromId: string, toId: string): Promise<void> {
  await query(
    `UPDATE memories
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'),
       '{graphEdges}',
       COALESCE(metadata->'graphEdges', '[]'::jsonb) || to_jsonb($2::text),
       true
     )
     WHERE id = $1`,
    [fromId, toId],
  );
}
