import { query } from '../db/client.js';

export interface ContextPackInput {
  query: string;
  project_id?: string;
  org_id?: string;
  user_id?: string;
  token_budget?: number;
}

export interface ContextPackSection {
  name: string;
  content: string;
  memoryIds: string[];
  tokens: number;
}

export interface ContextPack {
  sections: ContextPackSection[];
  totalTokens: number;
  memoriesUsed: string[];
  dropped: Array<{ name: string; reason: string; tokens: number }>;
}

/** Builds a minimal retrieval context pack with decisions first and vector fallback omitted unless needed elsewhere. */
export async function buildContextPack(input: ContextPackInput): Promise<ContextPack> {
  const budget = Math.max(1, input.token_budget ?? 4000);
  const sections: ContextPackSection[] = [];
  const dropped: Array<{ name: string; reason: string; tokens: number }> = [];
  let used = 0;

  const addSection = (section: ContextPackSection) => {
    if (used + section.tokens > budget) {
      const allowed = Math.max(0, budget - used);
      if (allowed > 40) {
        const compressed = compressToTokens(section.content, allowed);
        sections.push({ ...section, content: compressed, tokens: estimateTokens(compressed) });
        used += estimateTokens(compressed);
      } else {
        dropped.push({ name: section.name, reason: 'token_budget_exceeded', tokens: section.tokens });
      }
      return;
    }
    sections.push(section);
    used += section.tokens;
  };

  addSection(await rowsSection('decisions', await decisionRows(input), 'Relevant decisions'));
  addSection(await rowsSection('project', await projectRows(input), 'Active project facts'));
  addSection(await repoSection(input));
  if (isPersonalQuery(input.query)) addSection(await rowsSection('identity', await identityRows(input), 'Identity and preferences'));
  addSection(await rowsSection('active_task', await taskRows(input), 'Active task context'));

  const memoriesUsed = sections.flatMap((section) => section.memoryIds);
  return { sections, totalTokens: used, memoriesUsed, dropped };
}

function decisionRows(input: ContextPackInput) {
  return query(
    `SELECT id, content FROM memories
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND category = 'decision'
       AND ($1::text IS NULL OR org_id = $1)
       AND ($2::text IS NULL OR project_id = $2)
     ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST, updated_at DESC
     LIMIT 12`,
    [input.org_id ?? null, input.project_id ?? null],
  ).then((res) => res.rows);
}

function projectRows(input: ContextPackInput) {
  return query(
    `SELECT id, content FROM memories
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND category IN ('project','semantic','workflow')
       AND ($1::text IS NULL OR project_id = $1)
       AND ($2::text IS NULL OR org_id = $2)
     ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
     LIMIT 12`,
    [input.project_id ?? null, input.org_id ?? null],
  ).then((res) => res.rows);
}

function identityRows(input: ContextPackInput) {
  return query(
    `SELECT id, content FROM memories
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND category IN ('identity','preference')
       AND ($1::text IS NULL OR user_id = $1)
     ORDER BY importance_score DESC NULLS LAST, confidence_score DESC NULLS LAST
     LIMIT 8`,
    [input.user_id ?? null],
  ).then((res) => res.rows);
}

function taskRows(input: ContextPackInput) {
  return query(
    `SELECT id, content FROM memories
     WHERE memory_type != 'archived'
       AND superseded_by IS NULL
       AND memory_tier IN ('working','episodic')
       AND (expires_at IS NULL OR expires_at > NOW())
       AND ($1::text IS NULL OR project_id = $1)
     ORDER BY updated_at DESC
     LIMIT 8`,
    [input.project_id ?? null],
  ).then((res) => res.rows);
}

async function repoSection(input: ContextPackInput): Promise<ContextPackSection> {
  const result = await query(
    `SELECT id, repo_name, branch, services, apis, routes, db_schema, workflows, architecture_decisions, known_bugs, roadmap, deployment_notes
     FROM repo_memory
     WHERE ($1::text IS NULL OR org_id = $1)
     ORDER BY updated_at DESC
     LIMIT 3`,
    [input.org_id ?? null],
  );
  const lines = result.rows.map((repo) => {
    return [
      `${repo.repo_name}@${repo.branch}`,
      `services=${compactJson(repo.services)}`,
      `apis=${compactJson(repo.apis)}`,
      `routes=${compactJson(repo.routes)}`,
      `db=${compactJson(repo.db_schema)}`,
      `workflows=${compactJson(repo.workflows)}`,
      `decisions=${compactJson(repo.architecture_decisions)}`,
      `bugs=${compactJson(repo.known_bugs)}`,
      `roadmap=${compactJson(repo.roadmap)}`,
      `deploy=${compactJson(repo.deployment_notes)}`,
    ].join(' | ');
  });
  return makeSection('repo', 'Current repo state summary', result.rows.map((row) => row.id), lines);
}

async function rowsSection(name: string, rows: Array<{ id: string; content: string }>, title: string): Promise<ContextPackSection> {
  return makeSection(name, title, rows.map((row) => row.id), rows.map((row) => row.content));
}

function makeSection(name: string, title: string, memoryIds: string[], lines: string[]): ContextPackSection {
  const content = lines.length ? `${title}:\n${lines.join('\n')}` : `${title}: none`;
  return { name, content, memoryIds, tokens: estimateTokens(content) };
}

function isPersonalQuery(queryText: string): boolean {
  return /\b(my|me|i |preference|prefer|profile|identity|who am i)\b/i.test(queryText);
}

function compactJson(value: unknown): string {
  return JSON.stringify(value ?? []).slice(0, 600);
}

function compressToTokens(content: string, maxTokens: number): string {
  return content.slice(0, Math.max(0, maxTokens * 4));
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
