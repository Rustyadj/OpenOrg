import { jest } from '@jest/globals';
import { cleanDb, testApp } from './helpers.js';
import { query } from '../src/db/client.js';
import { compressBatch, compressMemory } from '../src/services/compression.js';
import { embed } from '../src/services/embed.js';
import { getOpenAI } from '../src/services/openai.js';

jest.mock('../src/services/openai.js', () => ({
  getOpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{ message: { content: 'Compressed memory keeps facts, entities, dates, numbers, and relationships in concise form. It remains searchable and semantically faithful while removing filler and repeated phrasing.' } }],
        })),
      },
    },
  })),
}));

jest.mock('../src/services/embed.js', () => ({
  embed: jest.fn(async () => Array.from({ length: 1024 }, () => 0.25)),
}));

function longContent(multiplier = 90) {
  return Array.from(
    { length: multiplier },
    (_, index) => `Fact ${index}: Cash works on Openclaw memory compression with project dates, named entities, numeric values, and relationships preserved.`,
  ).join(' ');
}

async function insertMemory(overrides: Record<string, unknown> = {}) {
  const result = await query(
    `INSERT INTO memories(memory_type, key, content, importance, confidence, recency, tags, metadata, compressed)
     VALUES ($1, $2, $3, $4, 0.8, $5, '{}', '{}', $6)
     RETURNING *`,
    [
      overrides.memory_type ?? 'agent',
      overrides.key ?? `compression-${Date.now()}-${Math.random()}`,
      overrides.content ?? longContent(),
      overrides.importance ?? 0.4,
      overrides.recency ?? new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      overrides.compressed ?? false,
    ],
  );
  return result.rows[0];
}

describe('memory compression', () => {
  beforeEach(async () => {
    jest.mocked(getOpenAI).mockClear();
    jest.mocked(embed).mockClear();
    await cleanDb();
  });

  test('compressMemory skips memories with importance >= 0.8', async () => {
    const memory = await insertMemory({ importance: 0.8 });
    const result = await compressMemory(memory.id);
    expect(result?.skipped).toBe(true);
    expect(result?.reason).toBe('high_importance');
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  test('compressMemory skips already-compressed memories', async () => {
    const memory = await insertMemory({ compressed: true });
    const result = await compressMemory(memory.id);
    expect(result?.skipped).toBe(true);
    expect(result?.reason).toBe('already_compressed');
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  test('compressMemory skips memories under 100 tokens', async () => {
    const memory = await insertMemory({ content: 'Short memory with too little content to justify compression.' });
    const result = await compressMemory(memory.id);
    expect(result?.skipped).toBe(true);
    expect(result?.reason).toBe('too_short');
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  test('compressBatch with dry_run=true makes no DB writes', async () => {
    const memory = await insertMemory();
    const result = await compressBatch({ dry_run: true, limit: 1 });
    const after = await query('SELECT compressed, content FROM memories WHERE id = $1', [memory.id]);

    expect(result.processed).toBe(1);
    expect(result.compressed).toBe(0);
    expect(after.rows[0].compressed).toBe(false);
    expect(after.rows[0].content).toBe(memory.content);
    expect(getOpenAI).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  test('GET /compression/stats returns expected shape', async () => {
    const { app, request } = await testApp();
    await insertMemory();
    const result = await request.get('/compression/stats').expect(200);

    expect(result.body).toEqual(expect.objectContaining({
      total_memories: expect.any(Number),
      compressed: expect.any(Number),
      uncompressed_eligible: expect.any(Number),
      total_tokens_saved: expect.any(Number),
      avg_compression_ratio: expect.any(Number),
    }));
    await app.close();
  });

  test('POST /compression/batch with limit=0 returns zero summary', async () => {
    const { app, request } = await testApp();
    const result = await request.post('/compression/batch').send({ limit: 0 }).expect(200);

    expect(result.body).toEqual({ processed: 0, compressed: 0, skipped: 0, tokens_saved: 0 });
    await app.close();
  });
});
