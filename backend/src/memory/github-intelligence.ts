import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { jsonChat } from '../services/openai.js';
import { deduplicateBeforeStore } from './deduplicator.js';
import type { RepoMemory } from './types.js';

interface RepoAnalysis {
  architectureOverview: string;
  services: string[];
  agentsOrWorkers: string[];
  workflows: string[];
  databaseSchemaSummary: string;
  roadmapItems: string[];
  keyDecisions: string[];
}

const REPO_SYSTEM_PROMPT = `Analyze repository evidence into structured operational memory.
Never store raw code. Return JSON with architectureOverview, services, agentsOrWorkers, workflows, databaseSchemaSummary, roadmapItems, and keyDecisions. Each item must be concise and factual.`;

/** Extracts structured repository understanding and stores it as a Repository memory. */
export async function analyzeRepository(repoUrl: string): Promise<RepoMemory> {
  const evidence = await collectRepositoryEvidence(repoUrl);
  const analysis = await jsonChat<RepoAnalysis>(
    process.env.MEMORY_REPO_ANALYSIS_MODEL ?? 'gpt-4o-mini',
    REPO_SYSTEM_PROMPT,
    { repoUrl, evidence },
  );
  const now = new Date();
  const memory: RepoMemory = {
    id: randomUUID(),
    content: buildRepositoryContent(repoUrl, analysis),
    category: 'Repository',
    importance: 8,
    confidence: evidence.length ? 0.82 : 0.55,
    source: `repository:${repoUrl}`,
    createdAt: now,
    updatedAt: now,
    tags: ['repository', repoUrl],
    graphEdges: [],
    revisionHistory: [],
    repoUrl,
    architectureOverview: analysis.architectureOverview,
    services: analysis.services ?? [],
    agentsOrWorkers: analysis.agentsOrWorkers ?? [],
    workflows: analysis.workflows ?? [],
    databaseSchemaSummary: analysis.databaseSchemaSummary,
    roadmapItems: analysis.roadmapItems ?? [],
    keyDecisions: analysis.keyDecisions ?? [],
  };
  await deduplicateBeforeStore(memory);
  return memory;
}

/** Collects high-signal repository evidence without loading raw source files wholesale. */
export async function collectRepositoryEvidence(repoUrl: string): Promise<Record<string, string>[]> {
  if (repoUrl.startsWith('http')) return collectGitHubEvidence(repoUrl);
  return collectLocalEvidence(repoUrl);
}

async function collectLocalEvidence(repoPath: string): Promise<Record<string, string>[]> {
  const root = path.resolve(repoPath);
  const files = await walk(root, 3);
  const interesting = files.filter((file) =>
    /(^|\/)(README|CHANGELOG|package|docker-compose|tsconfig|prisma|schema|migrations|\.github\/workflows)/i.test(path.relative(root, file)),
  ).slice(0, 40);
  const evidence: Record<string, string>[] = [];
  for (const file of interesting) {
    const text = await readFile(file, 'utf8').catch(() => '');
    evidence.push({ path: path.relative(root, file), summaryText: text.slice(0, 4000) });
  }
  return evidence;
}

async function collectGitHubEvidence(repoUrl: string): Promise<Record<string, string>[]> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return [];
  const [, owner, repoWithSuffix] = match;
  const repo = repoWithSuffix.replace(/\.git$/, '');
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const endpoints = [`${base}/readme`, `${base}/contents/.github/workflows`, `${base}/issues?state=open&per_page=20`, `${base}/pulls?state=all&per_page=20`];
  const evidence: Record<string, string>[] = [];
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers }).catch(() => null);
    if (!response?.ok) continue;
    const data = await response.json() as any;
    evidence.push({ path: endpoint, summaryText: JSON.stringify(data).slice(0, 5000) });
  }
  return evidence;
}

async function walk(dir: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) files.push(...await walk(full, depth - 1));
    else files.push(full);
  }
  return files;
}

function buildRepositoryContent(repoUrl: string, analysis: RepoAnalysis): string {
  return [
    `${repoUrl} architecture: ${analysis.architectureOverview}`,
    `Services: ${(analysis.services ?? []).join(', ') || 'none identified'}.`,
    `Workflows: ${(analysis.workflows ?? []).join(', ') || 'none identified'}.`,
    `Database: ${analysis.databaseSchemaSummary || 'No schema evidence identified'}.`,
    `Key decisions: ${(analysis.keyDecisions ?? []).join('; ') || 'none identified'}.`,
  ].join(' ');
}
