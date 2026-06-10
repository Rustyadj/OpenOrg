import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanDb, testApp, vector } from './helpers.js';
import { query } from '../src/db/client.js';
import { createMemoryThroughGate, runWriteGate } from '../src/memory/write-gate.js';
import { buildContextPack } from '../src/memory/context-pack.js';
import { ingestRepository } from '../src/repo/ingestor.js';

describe('Memory OS backend', () => {
  beforeEach(cleanDb);

  test('write-gate rejects importance < 5 as permanent', async () => {
    const gate = await runWriteGate({ content: 'What is the weather today?', forcePermanent: true });
    expect(gate.permanent).toBe(false);
    expect(gate.memory_tier).toBe('working');
    expect(gate.expires_at).toBeInstanceOf(Date);
  });

  test('write-gate detects chit-chat and assigns working tier', async () => {
    const gate = await runWriteGate({ content: 'lol thanks' });
    expect(gate.category).toBe('episodic');
    expect(gate.memory_tier).toBe('working');
    expect(gate.permanent).toBe(false);
  });

  test('decision memory forced to importance 10 with structured payload', async () => {
    const result = await createMemoryThroughGate({
      content: 'Decision: OpenClaw uses Postgres for memory because pgvector is already deployed.',
      category: 'decision',
      source: 'test',
      structured_payload: { decision: 'Use Postgres for memory', reasoning: 'pgvector is already deployed' },
      embedding: vector(0.1),
    });
    expect(result.gate.importance_score).toBe(10);
    expect(result.memory?.category).toBe('decision');
    expect((result.memory?.structured_payload as any).decision).toBe('Use Postgres for memory');
    expect(result.memory?.expiration_policy).toBe('never_archive');
  });

  test('duplicate above 0.90 similarity updates existing row and versions it', async () => {
    const first = await createMemoryThroughGate({
      content: 'Repository OpenClaw uses Fastify routes for Memory OS APIs.',
      category: 'repo',
      source: 'test-a',
      embedding: vector(0.1),
    });
    const second = await createMemoryThroughGate({
      content: 'Repository OpenClaw uses Fastify routes for Memory OS API handlers.',
      category: 'repo',
      source: 'test-b',
      embedding: vector(0.1),
    });

    expect(second.status).toBe('merged');
    expect(second.memory?.id).toBe(first.memory?.id);
    const versions = await query(`SELECT * FROM memory_versions WHERE memory_id = $1`, [first.memory?.id]);
    expect(versions.rowCount).toBe(1);
  });

  test('conflict record created when new memory contradicts existing', async () => {
    await createMemoryThroughGate({
      content: 'Project Atlas uses Redis for queue storage.',
      category: 'project',
      project_id: 'atlas',
      source: 'test',
      embedding: vector(0.2),
    });
    const result = await createMemoryThroughGate({
      content: 'Project Atlas no longer uses Redis for queue storage.',
      category: 'project',
      project_id: 'atlas',
      source: 'test',
      embedding: vector(0.3),
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    const conflicts = await query(`SELECT * FROM memory_conflicts WHERE resolution_status = 'unresolved'`);
    expect(conflicts.rowCount).toBeGreaterThan(0);
  });

  test('vector search is not the first retrieval step and explanation has score breakdown', async () => {
    const { app, request } = await testApp();
    await createMemoryThroughGate({
      content: 'Decision: OpenClaw keeps decision memories before vector matches because decisions guide future behavior.',
      category: 'decision',
      org_id: 'org-a',
      project_id: 'proj-a',
      source: 'test',
      embedding: vector(0.1),
    });
    await createMemoryThroughGate({
      content: 'Project proj-a tracks Memory OS storage and retrieval work.',
      category: 'project',
      org_id: 'org-a',
      project_id: 'proj-a',
      source: 'test',
      embedding: vector(0.1),
    });

    const res = await request.get('/memory/retrieve')
      .query({ query: 'memory storage', org_id: 'org-a', project_id: 'proj-a' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.meta.retrievalPath[0]).not.toBe('Vector Search');
    expect(res.body.meta.retrievalPath).toContain('Decision Memory');
    expect(res.body.meta.scoreBreakdown).toHaveProperty('finalScore');
    expect(res.body.data[0].retrievalPath).toBeDefined();
    await app.close();
  });

  test('repo ingestor produces structured repo_memory record', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openclaw-test-repo-'));
    try {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'tsx src/index.ts' } }));
      await writeFile(path.join(root, 'README.md'), 'Roadmap: add Memory OS. Deployment uses Docker. Known bug: stale context.');
      await mkdir(path.join(root, 'src', 'routes'), { recursive: true });
      await writeFile(path.join(root, 'src', 'routes', 'memory.ts'), "app.get('/memory/retrieve', async () => {}) // TODO improve route\n");
      await mkdir(path.join(root, 'migrations'), { recursive: true });
      await writeFile(path.join(root, 'migrations', '001.sql'), 'CREATE TABLE memories(id uuid primary key);');

      const result = await ingestRepository({ repoUrl: root, branch: 'main', org_id: 'org-repo' });
      expect(result.repoMemory.repo_name).toBe(path.basename(root));
      expect(Array.isArray(result.repoMemory.file_tree)).toBe(true);
      expect((result.repoMemory.routes as any[]).length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('context-pack respects token budget', async () => {
    await createMemoryThroughGate({
      content: 'Decision: Context packs keep decisions first because they constrain assistant behavior.',
      category: 'decision',
      org_id: 'org-pack',
      project_id: 'proj-pack',
      source: 'test',
      embedding: vector(0.1),
    });
    await createMemoryThroughGate({
      content: 'Project proj-pack has a very long semantic fact. ' + 'Memory OS '.repeat(300),
      category: 'project',
      org_id: 'org-pack',
      project_id: 'proj-pack',
      source: 'test',
      embedding: vector(0.1),
    });

    const pack = await buildContextPack({ query: 'project context', org_id: 'org-pack', project_id: 'proj-pack', token_budget: 80 });
    expect(pack.totalTokens).toBeLessThanOrEqual(80);
    expect(pack.sections[0].name).toBe('decisions');
  });
});
