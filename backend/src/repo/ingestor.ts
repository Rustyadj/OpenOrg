import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '../db/client.js';
import { embed } from '../services/embed.js';
import { createMemoryThroughGate } from '../memory/write-gate.js';

const execFileAsync = promisify(execFile);

export interface RepoIngestInput {
  repoUrl: string;
  branch?: string;
  org_id: string;
}

export interface RepoIngestResult {
  repoMemory: Record<string, unknown>;
  memory: Record<string, unknown> | undefined;
  changedSections: string[];
}

/** Ingests a repository into structured repo_memory and creates or updates a category=repo memory. */
export async function ingestRepository(input: RepoIngestInput): Promise<RepoIngestResult> {
  const branch = input.branch ?? 'main';
  const checkout = await prepareRepo(input.repoUrl, branch);
  try {
    const extracted = await extractRepo(checkout.path);
    const repoName = repoNameFromUrl(input.repoUrl);
    const embeddingText = summarizeRepo(repoName, branch, extracted);
    const embedding = await embed(embeddingText);
    const changedSections = await diffChangedSections(input.org_id, repoName, branch, extracted);
    const repoMemory = await upsertRepoMemory(input.org_id, repoName, branch, extracted, embedding);
    const memoryResult = await createMemoryThroughGate({
      content: embeddingText,
      org_id: input.org_id,
      project_id: repoName,
      category: 'repo',
      source: `repo.ingestor:${input.repoUrl}`,
      tags: ['repo', repoName, branch],
      embedding,
      forcePermanent: true,
    });
    return { repoMemory, memory: memoryResult.memory, changedSections };
  } finally {
    if (checkout.cleanup) await rm(checkout.path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Handles push/PR webhook payloads by re-ingesting the referenced repository when available. */
export async function handleRepoWebhook(payload: any): Promise<RepoIngestResult | null> {
  const repoUrl = payload?.repository?.clone_url ?? payload?.repository?.html_url;
  const branch = String(payload?.ref ?? payload?.pull_request?.head?.ref ?? 'main').replace(/^refs\/heads\//, '');
  const orgId = payload?.organization?.login ?? payload?.repository?.owner?.login ?? payload?.org_id;
  if (!repoUrl || !orgId) return null;
  return ingestRepository({ repoUrl, branch, org_id: orgId });
}

async function prepareRepo(repoUrl: string, branch: string): Promise<{ path: string; cleanup: boolean }> {
  const localPath = path.resolve(repoUrl);
  const localStat = await stat(localPath).catch(() => null);
  if (localStat?.isDirectory()) return { path: localPath, cleanup: false };

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'openclaw-repo-'));
  await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, tmp], { timeout: 120000 });
  return { path: tmp, cleanup: true };
}

async function extractRepo(root: string): Promise<Record<string, unknown>> {
  const files = await walk(root, 5);
  const relFiles = files.map((file) => path.relative(root, file)).sort();
  const textFiles = await readInterestingFiles(root, relFiles);
  const packageJson = parseJson(textFiles['package.json']);
  const services = relFiles.filter((file) => /(^|\/)(services?|workers?|agents?)\//i.test(file));
  const apis = relFiles.filter((file) => /(^|\/)(routes?|api)\//i.test(file));
  const routes = [...apis, ...extractRouteStrings(textFiles)];
  const workflows = relFiles.filter((file) => file.startsWith('.github/workflows/') || /workflow|runbook|queue|bullmq/i.test(file));
  const components = relFiles.filter((file) => /(^|\/)(components?|ui)\//i.test(file));
  const dbSchema = relFiles.filter((file) => /migration|schema|prisma|sql$/i.test(file));
  const todos = extractLines(textFiles, /\b(TODO|FIXME)\b/i);
  const knownBugs = extractLines(textFiles, /\b(bug|known issue|FIXME)\b/i);
  const roadmap = extractLines(textFiles, /\b(roadmap|milestone|next|planned)\b/i);
  const deploymentNotes = extractLines(textFiles, /\b(deploy|docker|kubernetes|helm|vercel|render|systemd)\b/i);
  const commitSummaries = await gitLines(root, ['log', '-50', '--pretty=format:%h %s']).then((lines) => lines.map((line) => ({ summary: line })));
  const prSummaries: Array<Record<string, unknown>> = [];
  const architectureDecisions = commitSummaries
    .filter((item) => /\b(decide|decision|architecture|refactor|migrate|replace|adopt)\b/i.test(String(item.summary)))
    .map((item) => ({ source: 'commit', decision: item.summary }));

  return {
    commit_summaries: commitSummaries,
    pr_summaries: prSummaries,
    file_tree: relFiles,
    services: services.map((name) => ({ name })),
    apis: apis.map((name) => ({ file: name })),
    db_schema: dbSchema.map((name) => ({ file: name })),
    routes: routes.map((route) => typeof route === 'string' ? { route } : route),
    components: components.map((name) => ({ file: name })),
    workflows: workflows.map((name) => ({ file: name })),
    architecture_decisions: architectureDecisions,
    todos,
    known_bugs: knownBugs,
    roadmap,
    deployment_notes: deploymentNotes,
    package: packageJson ?? {},
  };
}

async function upsertRepoMemory(orgId: string, repoName: string, branch: string, extracted: Record<string, unknown>, embedding: number[]): Promise<Record<string, unknown>> {
  const result = await query(
    `INSERT INTO repo_memory(
       org_id, repo_name, branch, commit_summaries, pr_summaries, file_tree,
       services, apis, db_schema, routes, components, workflows,
       architecture_decisions, todos, known_bugs, roadmap, deployment_notes, embedding
     )
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::vector)
     ON CONFLICT (org_id, repo_name, branch)
     DO UPDATE SET
       commit_summaries = EXCLUDED.commit_summaries,
       pr_summaries = EXCLUDED.pr_summaries,
       file_tree = EXCLUDED.file_tree,
       services = EXCLUDED.services,
       apis = EXCLUDED.apis,
       db_schema = EXCLUDED.db_schema,
       routes = EXCLUDED.routes,
       components = EXCLUDED.components,
       workflows = EXCLUDED.workflows,
       architecture_decisions = EXCLUDED.architecture_decisions,
       todos = EXCLUDED.todos,
       known_bugs = EXCLUDED.known_bugs,
       roadmap = EXCLUDED.roadmap,
       deployment_notes = EXCLUDED.deployment_notes,
       embedding = EXCLUDED.embedding,
       updated_at = NOW()
     RETURNING *`,
    [
      orgId,
      repoName,
      branch,
      JSON.stringify(extracted.commit_summaries ?? []),
      JSON.stringify(extracted.pr_summaries ?? []),
      JSON.stringify(extracted.file_tree ?? []),
      JSON.stringify(extracted.services ?? []),
      JSON.stringify(extracted.apis ?? []),
      JSON.stringify(extracted.db_schema ?? []),
      JSON.stringify(extracted.routes ?? []),
      JSON.stringify(extracted.components ?? []),
      JSON.stringify(extracted.workflows ?? []),
      JSON.stringify(extracted.architecture_decisions ?? []),
      JSON.stringify(extracted.todos ?? []),
      JSON.stringify(extracted.known_bugs ?? []),
      JSON.stringify(extracted.roadmap ?? []),
      JSON.stringify(extracted.deployment_notes ?? []),
      vectorLiteral(embedding),
    ],
  );
  return result.rows[0];
}

async function diffChangedSections(orgId: string, repoName: string, branch: string, extracted: Record<string, unknown>): Promise<string[]> {
  const result = await query(`SELECT * FROM repo_memory WHERE org_id = $1 AND repo_name = $2 AND branch = $3`, [orgId, repoName, branch]);
  const old = result.rows[0];
  if (!old) return Object.keys(extracted);
  const sections = ['commit_summaries', 'pr_summaries', 'file_tree', 'services', 'apis', 'db_schema', 'routes', 'components', 'workflows', 'architecture_decisions', 'todos', 'known_bugs', 'roadmap', 'deployment_notes'];
  return sections.filter((section) => JSON.stringify(old[section] ?? []) !== JSON.stringify(extracted[section] ?? []));
}

async function walk(dir: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (['.git', 'node_modules', 'dist', 'build', 'coverage'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) files.push(...await walk(full, depth - 1));
    else if (info.size < 250_000) files.push(full);
  }
  return files;
}

async function readInterestingFiles(root: string, relFiles: string[]): Promise<Record<string, string>> {
  const interesting = relFiles.filter((file) => /README|CHANGELOG|package\.json|docker|compose|route|api|schema|migration|\.sql|\.ts|\.tsx|\.js|\.md|\.yml|\.yaml/i.test(file)).slice(0, 160);
  const out: Record<string, string> = {};
  for (const rel of interesting) out[rel] = (await readFile(path.join(root, rel), 'utf8').catch(() => '')).slice(0, 8000);
  return out;
}

function extractRouteStrings(files: Record<string, string>): string[] {
  const routes = new Set<string>();
  for (const text of Object.values(files)) {
    for (const match of text.matchAll(/\.(get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/g)) routes.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return [...routes];
}

function extractLines(files: Record<string, string>, pattern: RegExp): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const [file, text] of Object.entries(files)) {
    for (const line of text.split('\n')) {
      if (pattern.test(line)) rows.push({ file, text: line.trim().slice(0, 300) });
      if (rows.length >= 80) return rows;
    }
  }
  return rows;
}

async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30000 }).catch(() => ({ stdout: '' }));
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function summarizeRepo(repoName: string, branch: string, extracted: Record<string, unknown>): string {
  return [
    `Repository ${repoName} branch ${branch} has ${(extracted.file_tree as unknown[]).length} tracked files.`,
    `Services: ${JSON.stringify(extracted.services).slice(0, 600)}.`,
    `APIs/routes: ${JSON.stringify(extracted.routes).slice(0, 600)}.`,
    `Database schema: ${JSON.stringify(extracted.db_schema).slice(0, 600)}.`,
    `Architecture decisions: ${JSON.stringify(extracted.architecture_decisions).slice(0, 600)}.`,
  ].join(' ');
}

function repoNameFromUrl(repoUrl: string): string {
  return path.basename(repoUrl.replace(/\.git$/, '')) || `repo-${randomUUID().slice(0, 8)}`;
}

function parseJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
