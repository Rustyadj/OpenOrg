import { jest, afterAll } from '@jest/globals';
import { pool } from '../src/db/client.js';

// ── OpenAI mock ──────────────────────────────────────────────────────────────
// Applied globally via setupFilesAfterEnv so every test file gets it without
// re-declaring. The mock covers both the openai default export and voyageai.

const mockCompletion = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          lesson: 'Mocked lesson',
          failure_mode: null,
          improvement: 'Mocked improvement',
          importance: 0.7,
          score: 8,
          rationale: 'Mocked rationale',
          skills: [],
        }),
      },
    },
  ],
};

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => mockCompletion),
      },
    },
    embeddings: {
      create: jest.fn(async () => ({ data: [{ embedding: Array(1024).fill(0.1) }] })),
    },
  })),
}));

// Mock voyageai so embed() calls return fast without network I/O
jest.mock('voyageai', () => ({
  __esModule: true,
  VoyageAIClient: jest.fn().mockImplementation(() => ({
    embed: jest.fn(async () => ({
      data: [{ embedding: Array(1024).fill(0.1) }],
    })),
  })),
}));

// ── Global teardown ───────────────────────────────────────────────────────────
// Closes the pg pool after all tests in every suite, eliminating the Jest
// open-handle warning caused by the pool's idle-client timer.
afterAll(async () => {
  await pool.end().catch(() => null);
});
