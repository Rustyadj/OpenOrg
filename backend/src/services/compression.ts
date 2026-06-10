import { query } from '../db/client.js';
import { embed } from './embed.js';
import { appendMemoryAudit } from './memory.js';
import { getOpenAI } from './openai.js';

const COMPRESS_SYSTEM_PROMPT = `You are a memory compressor. Rewrite the following memory into the minimum
      number of tokens that preserves all factual claims, named entities, numeric
      values, dates, and relationships. Remove filler words, examples, and
      redundant phrasing. Output only the compressed text, no explanation.`;

export type CompressResult = {
  id: string;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  skipped?: boolean;
  reason?: string;
};

export type CompressBatchOptions = {
  max_age_days?: number;
  max_importance?: number;
  limit?: number;
  agent_id?: string;
  dry_run?: boolean;
};

function countTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`;
}

function skipped(id: string, reason: string, originalTokens = 0): CompressResult {
  return {
    id,
    original_tokens: originalTokens,
    compressed_tokens: 0,
    compression_ratio: 1,
    skipped: true,
    reason,
  };
}

async function loadMemory(memoryId: string) {
  const result = await query(
    `SELECT id, content, embedding, importance, memory_type, compressed
     FROM memories
     WHERE id = $1`,
    [memoryId],
  );
  return result.rows[0] ?? null;
}

async function compressText(content: string) {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  });
  return (response.choices[0]?.message?.content ?? '').trim();
}

export async function compressMemory(memoryId: string): Promise<CompressResult | null> {
  const memory = await loadMemory(memoryId);
  if (!memory) return null;

  const originalTokens = countTokens(memory.content ?? '');
  if (memory.compressed) return skipped(memoryId, 'already_compressed', originalTokens);
  if (memory.memory_type === 'archived') return skipped(memoryId, 'archived', originalTokens);
  if (Number(memory.importance) >= 0.8) return skipped(memoryId, 'high_importance', originalTokens);
  if (originalTokens < 100) return skipped(memoryId, 'too_short', originalTokens);

  const compressedContent = await compressText(memory.content);
  const compressedTokens = countTokens(compressedContent);
  if (compressedTokens < 20) return skipped(memoryId, 'compressed_too_short', originalTokens);

  const compressionRatio = compressedTokens / originalTokens;
  if (compressionRatio > 0.85) return skipped(memoryId, 'insufficient_reduction', originalTokens);

  const newEmbedding = await embed(compressedContent);
  await query(
    `UPDATE memories
     SET content = $2,
         embedding = $3::vector,
         compressed = TRUE,
         original_token_count = $4,
         compressed_token_count = $5,
         compression_ratio = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [memoryId, compressedContent, vectorLiteral(newEmbedding), originalTokens, compressedTokens, compressionRatio],
  );
  await appendMemoryAudit(memoryId, 'compressed', 'dreaming.compression', {
    original_tokens: originalTokens,
    compressed_tokens: compressedTokens,
    compression_ratio: compressionRatio,
  });

  return {
    id: memoryId,
    original_tokens: originalTokens,
    compressed_tokens: compressedTokens,
    compression_ratio: compressionRatio,
  };
}

export async function compressBatch(opts: CompressBatchOptions = {}) {
  const maxAgeDays = opts.max_age_days ?? 7;
  const maxImportance = opts.max_importance ?? 0.8;
  const limit = Math.max(0, opts.limit ?? 50);
  if (limit === 0) return { processed: 0, compressed: 0, skipped: 0, tokens_saved: 0 };

  const params: unknown[] = [maxImportance, `${maxAgeDays} days`, limit];
  const wheres = [
    `NOT COALESCE(compressed, FALSE)`,
    `memory_type != 'archived'`,
    `superseded_by IS NULL`,
    `importance < $1`,
    `recency < NOW() - $2::interval`,
    `length(content) / 4 >= 100`,
  ];
  if (opts.agent_id) {
    params.push(opts.agent_id);
    wheres.push(`agent_id = $${params.length}`);
  }

  const result = await query(
    `SELECT id, content
     FROM memories
     WHERE ${wheres.join(' AND ')}
     ORDER BY importance ASC, recency ASC
     LIMIT $3`,
    params,
  );

  if (opts.dry_run) {
    return {
      processed: result.rows.length,
      compressed: 0,
      skipped: 0,
      tokens_saved: 0,
    };
  }

  let compressed = 0;
  let skippedCount = 0;
  let tokensSaved = 0;
  for (const row of result.rows) {
    const outcome = await compressMemory(row.id);
    if (!outcome || outcome.skipped) {
      skippedCount++;
      continue;
    }
    compressed++;
    tokensSaved += outcome.original_tokens - outcome.compressed_tokens;
  }

  return {
    processed: result.rows.length,
    compressed,
    skipped: skippedCount,
    tokens_saved: tokensSaved,
  };
}

export async function getCompressionStats() {
  const result = await query(
    `SELECT
       COUNT(*)::int AS total_memories,
       COUNT(*) FILTER (WHERE COALESCE(compressed, FALSE))::int AS compressed,
       COUNT(*) FILTER (
         WHERE NOT COALESCE(compressed, FALSE)
           AND memory_type != 'archived'
           AND superseded_by IS NULL
           AND importance < 0.8
           AND recency < NOW() - INTERVAL '7 days'
           AND length(content) / 4 >= 100
       )::int AS uncompressed_eligible,
       COALESCE(SUM(original_token_count - compressed_token_count) FILTER (WHERE COALESCE(compressed, FALSE)), 0)::int AS total_tokens_saved,
       COALESCE(AVG(compression_ratio) FILTER (WHERE COALESCE(compressed, FALSE)), 0)::float AS avg_compression_ratio
     FROM memories`,
  );
  return result.rows[0];
}
