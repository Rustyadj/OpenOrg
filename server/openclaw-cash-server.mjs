/**
 * openclaw-cash memory proxy
 *
 * Model roles:
 *   Embeddings          → Voyage (voyage-3, 1024-dim)
 *   Memory retrieval    → pgvector cosine similarity
 *   Summarization       → DeepSeek V4 Flash (openrouter)
 *   Learning loop       → DeepSeek V4 Flash
 *   Skill extraction    → DeepSeek V4 Flash
 *   Memory compression  → DeepSeek V4 Flash
 *   Nightly consolidation → DeepSeek V4 Flash
 *   Complex reasoning   → Claude Sonnet 4.6 (OAuth, via core agent)
 *   Coding              → Codex GPT-5.5 (OAuth, via core agent)
 */
import { createServer } from 'http';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT || '50348');
const CORE_PORT = PORT + 1;

const REDIS_HOST = process.env.MEMORY_REDIS_HOST || 'openclaw-redis';
const REDIS_PORT = parseInt(process.env.MEMORY_REDIS_PORT || '6379');
const PG_HOST    = process.env.MEMORY_PG_HOST    || 'openclaw-pgvector';
const PG_PORT    = parseInt(process.env.MEMORY_PG_PORT    || '5432');
const PG_DB      = process.env.MEMORY_PG_DB      || 'openclaw';
const PG_USER    = process.env.MEMORY_PG_USER    || 'openclaw';
const PG_PASS    = process.env.MEMORY_PG_PASS    || 'openclaw';

const VOYAGE_API_KEY    = process.env.VOYAGE_API_KEY || '';
const VOYAGE_MODEL      = 'voyage-3';
const VOYAGE_DIMS       = 1024;

const OPENROUTER_KEY    = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_MODEL    = 'deepseek/deepseek-v4-flash';

// ── Start core server ─────────────────────────────────────────────────────────
const core = spawn(process.execPath, ['/hostinger/server-core.mjs'], {
  env: { ...process.env, PORT: String(CORE_PORT) },
  stdio: 'inherit',
});
core.on('exit', (code) => {
  console.error(`[mem-proxy] core exited (${code})`);
  process.exit(code ?? 1);
});

// ── Redis ─────────────────────────────────────────────────────────────────────
let redis = null;
try {
  const Redis = require('/data/.npm-global/lib/node_modules/ioredis/built/index.js');
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT,
    lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1 });
  await client.connect();
  redis = client;
  console.log(`[mem-proxy] Redis → ${REDIS_HOST}:${REDIS_PORT}`);
} catch (e) {
  console.warn(`[mem-proxy] Redis unavailable: ${e.message}`);
}

// ── pgvector ──────────────────────────────────────────────────────────────────
let pg = null;
try {
  const { Pool } = require('/data/.npm-global/lib/node_modules/pg/lib/index.js');
  const pool = new Pool({ host: PG_HOST, port: PG_PORT, database: PG_DB,
    user: PG_USER, password: PG_PASS, connectionTimeoutMillis: 3000 });
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      key        TEXT PRIMARY KEY,
      scope      TEXT,
      type       TEXT,
      agent_id   TEXT,
      preview    TEXT,
      content    TEXT,
      embedding  vector(${VOYAGE_DIMS}),
      updated    TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS project_id TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS chat_id TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS category TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS source TEXT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS importance_score INT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS confidence_score FLOAT`);
  await pool.query(`ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS expiration_policy TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_agent_key_uidx ON agent_memory(agent_id, key)`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS agent_memory_embedding_idx
    ON agent_memory USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 20)`).catch(() => {});  // needs enough rows; ok if it fails
  pg = pool;
  console.log(`[mem-proxy] pgvector → ${PG_HOST}:${PG_PORT}/${PG_DB}`);
} catch (e) {
  console.warn(`[mem-proxy] pgvector unavailable: ${e.message}`);
}

if (!redis && !pg) console.warn('[mem-proxy] no memory backends — falling through to core');

// ── Voyage embeddings ─────────────────────────────────────────────────────────
async function embed(texts) {
  if (!VOYAGE_API_KEY || !texts.length) return null;
  try {
    const r = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.data?.map(x => x.embedding) ?? null;
  } catch { return null; }
}

// ── DeepSeek via OpenRouter ───────────────────────────────────────────────────
async function deepseek(systemPrompt, userContent, maxTokens = 512) {
  if (!OPENROUTER_KEY) return null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://openclaw.ai',
        'X-Title': 'openclaw-cash' },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

// ── Memory helpers ────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let buf = '';
    req.on('data', c => { buf += c; });
    req.on('end', () => { try { res(buf ? JSON.parse(buf) : {}); } catch { res({}); } });
    req.on('error', rej);
  });
}

function sendJson(res, statusOrBody, body) {
  const status = typeof statusOrBody === 'number' ? statusOrBody : 200;
  const data   = typeof statusOrBody === 'number' ? body : statusOrBody;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function memList(agentId, filters = {}) {
  if (pg) {
    const wheres = [];
    const params = [];
    const add = (sql, value) => { if (value) { params.push(value); wheres.push(sql.replace('?', `$${params.length}`)); } };
    add('agent_id=?', agentId);
    add('user_id=?', filters.user_id);
    add('org_id=?', filters.org_id);
    add('project_id=?', filters.project_id);
    add('chat_id=?', filters.chat_id);
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const r = await pg.query(
      `SELECT key,scope,type,agent_id,user_id,org_id,project_id,chat_id,category,source,
              importance_score,confidence_score,expiration_policy,preview,content,updated
       FROM agent_memory ${where} ORDER BY updated DESC LIMIT 500`,
      params);
    return r.rows;
  }
  if (redis) {
    const keys = await redis.keys('mem:*');
    if (!keys.length) return [];
    const vals = await redis.mget(...keys);
    return vals.flatMap(v => {
      try {
        const rec = JSON.parse(v);
        if (agentId && rec.agent_id !== agentId) return [];
        for (const field of ['user_id', 'org_id', 'project_id', 'chat_id']) {
          if (filters[field] && rec[field] !== filters[field]) return [];
        }
        return [rec];
      } catch {
        return [];
      }
    });
  }
  return null;
}

async function memSearch(query, limit = 20, filters = {}) {
  const minSimilarity = Number(filters.min_similarity ?? 0.35);
  const embs = await embed([query]);
  if (pg && embs) {
    const vec = `[${embs[0].join(',')}]`;
    const r = await pg.query(
      `SELECT key,scope,type,agent_id,user_id,org_id,project_id,chat_id,category,source,
              importance_score,confidence_score,expiration_policy,preview,content,updated,
              1 - (embedding <=> $1::vector) AS similarity,
              CASE
                WHEN $3::text IS NOT NULL AND chat_id = $3 THEN 1
                WHEN $4::text IS NOT NULL AND project_id = $4 THEN 2
                WHEN $5::text IS NOT NULL AND org_id = $5 AND project_id IS NULL THEN 3
                WHEN $6::text IS NOT NULL AND user_id = $6 AND project_id IS NULL AND org_id IS NULL THEN 4
                ELSE 8
              END AS scope_rank
       FROM agent_memory
       WHERE embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $7
         AND ($8::text IS NULL OR agent_id = $8)
         AND (
           ($3::text IS NOT NULL AND chat_id = $3)
           OR ($4::text IS NOT NULL AND project_id = $4)
           OR ($5::text IS NOT NULL AND org_id = $5 AND project_id IS NULL)
           OR ($6::text IS NOT NULL AND user_id = $6 AND project_id IS NULL AND org_id IS NULL)
           OR (
             $3::text IS NULL AND $4::text IS NULL AND $5::text IS NULL AND $6::text IS NULL
             AND chat_id IS NULL AND project_id IS NULL AND org_id IS NULL AND user_id IS NULL
           )
         )
      ORDER BY scope_rank ASC, embedding <=> $1::vector LIMIT $2`,
      [vec, limit, filters.chat_id ?? null, filters.project_id ?? null, filters.org_id ?? null,
       filters.user_id ?? null, minSimilarity, filters.agent_id ?? null]);
    return r.rows;
  }
  // Keyword fallback
  if (pg) {
    const r = await pg.query(
      `SELECT key,scope,type,agent_id,user_id,org_id,project_id,chat_id,category,source,
              importance_score,confidence_score,expiration_policy,preview,content,updated
       FROM agent_memory
       WHERE (preview ILIKE $1 OR content ILIKE $1)
         AND ($7::text IS NULL OR agent_id = $7)
         AND (
           ($3::text IS NOT NULL AND chat_id = $3)
           OR ($4::text IS NOT NULL AND project_id = $4)
           OR ($5::text IS NOT NULL AND org_id = $5 AND project_id IS NULL)
           OR ($6::text IS NOT NULL AND user_id = $6 AND project_id IS NULL AND org_id IS NULL)
           OR (
             $3::text IS NULL AND $4::text IS NULL AND $5::text IS NULL AND $6::text IS NULL
             AND chat_id IS NULL AND project_id IS NULL AND org_id IS NULL AND user_id IS NULL
           )
         )
      ORDER BY updated DESC LIMIT $2`,
      [`%${query}%`, limit, filters.chat_id ?? null, filters.project_id ?? null,
       filters.org_id ?? null, filters.user_id ?? null, filters.agent_id ?? null]);
    return r.rows;
  }
  return [];
}

async function memUpsert(entry) {
  const now = new Date().toISOString();
  const rec = { ...entry, updated: now };
  const text = [rec.preview, rec.content].filter(Boolean).join(' ');
  const embs = await embed([text]);
  const vec  = embs ? `[${embs[0].join(',')}]` : null;

  if (pg) {
    await pg.query(
      `INSERT INTO agent_memory(
         key,scope,type,agent_id,user_id,org_id,project_id,chat_id,category,source,
         importance_score,confidence_score,expiration_policy,preview,content,embedding,updated
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::vector,$17)
       ON CONFLICT(key) DO UPDATE SET scope=EXCLUDED.scope,type=EXCLUDED.type,
         agent_id=EXCLUDED.agent_id,user_id=EXCLUDED.user_id,org_id=EXCLUDED.org_id,
         project_id=EXCLUDED.project_id,chat_id=EXCLUDED.chat_id,category=EXCLUDED.category,
         source=EXCLUDED.source,importance_score=EXCLUDED.importance_score,
         confidence_score=EXCLUDED.confidence_score,expiration_policy=EXCLUDED.expiration_policy,
         preview=EXCLUDED.preview,content=EXCLUDED.content,
         embedding=EXCLUDED.embedding,updated=EXCLUDED.updated`,
      [rec.key, rec.scope ?? null, rec.type ?? null, rec.agent_id ?? null,
       rec.user_id ?? null, rec.org_id ?? null, rec.project_id ?? null, rec.chat_id ?? null,
       rec.category ?? null, rec.source ?? null, rec.importance_score ?? null,
       rec.confidence_score ?? null, rec.expiration_policy ?? null,
       rec.preview ?? null, rec.content ?? null, vec, now]);
  }
  if (redis) await redis.set(`mem:${rec.key}`, JSON.stringify(rec));
  return rec;
}

async function memPatch(key, patch) {
  const now = new Date().toISOString();
  if (pg) {
    const cols = { preview:'preview', content:'content', scope:'scope',
                   type:'type', agent_id:'agent_id', user_id:'user_id',
                   org_id:'org_id', project_id:'project_id', chat_id:'chat_id',
                   category:'category', source:'source', importance_score:'importance_score',
                   confidence_score:'confidence_score', expiration_policy:'expiration_policy',
                   updated:'updated' };
    const sets = []; const vals = [key];
    for (const [k, v] of Object.entries({ ...patch, updated: now })) {
      if (cols[k]) sets.push(`${cols[k]}=$${vals.push(v)}`);
    }
    if (sets.length) await pg.query(`UPDATE agent_memory SET ${sets.join(',')} WHERE key=$1`, vals);
    // Re-embed if content/preview changed
    if (patch.content || patch.preview) {
      const r = await pg.query('SELECT preview,content FROM agent_memory WHERE key=$1', [key]);
      if (r.rows[0]) {
        const text = [r.rows[0].preview, r.rows[0].content].filter(Boolean).join(' ');
        const embs = await embed([text]);
        if (embs) {
          const vec = `[${embs[0].join(',')}]`;
          await pg.query('UPDATE agent_memory SET embedding=$1::vector WHERE key=$2', [vec, key]);
        }
      }
    }
    const r2 = await pg.query(
      `SELECT key,scope,type,agent_id,user_id,org_id,project_id,chat_id,category,source,
              importance_score,confidence_score,expiration_policy,preview,content,updated
       FROM agent_memory WHERE key=$1`, [key]);
    return r2.rows[0] ?? { key, ...patch, updated: now };
  }
  if (redis) {
    const raw = await redis.get(`mem:${key}`);
    const merged = { ...(raw ? JSON.parse(raw) : {}), ...patch, key, updated: now };
    await redis.set(`mem:${key}`, JSON.stringify(merged));
    return merged;
  }
  return null;
}

function classifyProxyMemory(text) {
  if (/\b(decision|decided|approved|chose|because)\b/i.test(text)) return { category: 'decision', type: 'Decision', importance_score: 10, confidence_score: 0.86, expiration_policy: 'never_archive' };
  if (/\b(prefers|preference|always|never|likes|dislikes)\b/i.test(text)) return { category: 'preference', type: 'Preference', importance_score: 8, confidence_score: 0.78, expiration_policy: 'retain_until_superseded' };
  if (/\b(repo|repository|github|branch|commit|pull request|schema)\b/i.test(text)) return { category: 'repo', type: 'Repository', importance_score: 8, confidence_score: 0.78, expiration_policy: 'retain_until_superseded' };
  if (/\b(org|organization|company|team|governance|proposal|vote)\b/i.test(text)) return { category: 'org', type: 'Org', importance_score: 7, confidence_score: 0.76, expiration_policy: 'retain_until_superseded' };
  if (/\b(project|milestone|roadmap|sprint)\b/i.test(text)) return { category: 'project', type: 'Project', importance_score: 7, confidence_score: 0.76, expiration_policy: 'retain_until_superseded' };
  if (/\b(workflow|runbook|process|procedure)\b/i.test(text)) return { category: 'workflow', type: 'Workflow', importance_score: 7, confidence_score: 0.76, expiration_policy: 'retain_until_superseded' };
  return { category: 'episodic', type: 'Working', importance_score: 3, confidence_score: 0.6, expiration_policy: 'ttl_24h' };
}

function shouldStoreProxyMemory(text) {
  if (!text || text.length < 10 || text.length > 800) return false;
  if (/^(hi|hello|hey|ok|yes|no|sure|thanks|thx|bye|\.+|!+|\?+)$/i.test(text.trim())) return false;
  const classified = classifyProxyMemory(text);
  return classified.importance_score >= 5 && /\b(remember|save this|note that|decision|decided|approved|prefers|preference|always|never|project|org|organization|repo|repository|workflow|runbook|schema|roadmap)\b/i.test(text);
}

async function memDelete(key) {
  if (pg) await pg.query('DELETE FROM agent_memory WHERE key=$1', [key]);
  if (redis) await redis.del(`mem:${key}`);
  return !!(pg || redis);
}

// ── Memory pipeline tasks (DeepSeek V4 Flash) ────────────────────────────────

async function summarizeMemories(agentId) {
  if (!pg) return;
  const r = await pg.query(
    `SELECT key, preview, content FROM agent_memory
     WHERE agent_id=$1 AND type='Transcript'
     ORDER BY updated DESC LIMIT 20`, [agentId]);
  if (r.rows.length < 3) return;
  const corpus = r.rows.map(m => `[${m.key}] ${m.preview}`).join('\n');
  const summary = await deepseek(
    'You are a memory summarizer. Distill the key facts, decisions, and patterns from these agent memory entries into a concise paragraph. Preserve proper nouns, numbers, and actionable items.',
    corpus, 400);
  if (!summary) return;
  await memUpsert({
    key: `summary.${agentId}.${Date.now()}`,
    scope: 'agent',
    type: 'Summary',
    agent_id: agentId,
    preview: summary.slice(0, 160),
    content: summary,
  });
}

async function extractSkills(agentId) {
  if (!pg) return;
  const r = await pg.query(
    `SELECT preview, content FROM agent_memory
     WHERE agent_id=$1 AND type IN ('Transcript','Summary')
     ORDER BY updated DESC LIMIT 15`, [agentId]);
  if (r.rows.length < 2) return;
  const corpus = r.rows.map(m => m.content || m.preview).join('\n\n');
  const skills = await deepseek(
    'You are a skill extractor. From these agent interaction logs, identify distinct capabilities or skills demonstrated. Return a JSON array of strings, each 2–6 words. Only the JSON array, no other text.',
    corpus, 300);
  if (!skills) return;
  try {
    const list = JSON.parse(skills);
    if (!Array.isArray(list)) return;
    await memUpsert({
      key: `skills.${agentId}`,
      scope: 'agent',
      type: 'Skills',
      agent_id: agentId,
      preview: list.slice(0, 5).join(', '),
      content: JSON.stringify(list),
    });
  } catch { /* malformed JSON */ }
}

async function compressMemories(agentId) {
  if (!pg) return;
  // Merge old Transcript entries (>7 days) into compressed summaries
  const r = await pg.query(
    `SELECT key, preview, content FROM agent_memory
     WHERE agent_id=$1 AND type='Transcript'
       AND updated < now() - interval '7 days'
     ORDER BY updated ASC LIMIT 30`, [agentId]);
  if (r.rows.length < 5) return;
  const corpus = r.rows.map(m => m.content || m.preview).join('\n');
  const compressed = await deepseek(
    'Compress these old memory entries into a dense factual summary, preserving all important context, decisions, and outcomes. Max 300 words.',
    corpus, 400);
  if (!compressed) return;
  const keys = r.rows.map(m => m.key);
  await pg.query(`DELETE FROM agent_memory WHERE key = ANY($1)`, [keys]);
  if (redis) await Promise.all(keys.map(k => redis.del(`mem:${k}`)));
  await memUpsert({
    key: `compressed.${agentId}.${Date.now()}`,
    scope: 'agent',
    type: 'Compressed',
    agent_id: agentId,
    preview: compressed.slice(0, 160),
    content: compressed,
  });
}

async function learningLoop() {
  if (!pg) return;
  const agents = await pg.query(
    `SELECT DISTINCT agent_id FROM agent_memory WHERE agent_id IS NOT NULL`);
  for (const { agent_id } of agents.rows) {
    await summarizeMemories(agent_id);
    await extractSkills(agent_id);
  }
}

async function nightlyConsolidation() {
  if (!pg) return;
  const agents = await pg.query(
    `SELECT DISTINCT agent_id FROM agent_memory WHERE agent_id IS NOT NULL`);
  for (const { agent_id } of agents.rows) {
    await compressMemories(agent_id);
    await summarizeMemories(agent_id);
    await extractSkills(agent_id);
  }
  console.log('[mem-proxy] nightly consolidation complete');
}

// ── Schedule background jobs ──────────────────────────────────────────────────
function scheduleDaily(hour, fn) {
  function runAt(h) {
    const now  = new Date();
    const next = new Date();
    next.setHours(h, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    setTimeout(() => { fn().catch(e => console.error('[mem-proxy] job error:', e.message)); scheduleDaily(h, fn); }, ms);
  }
  runAt(hour);
}

// Learning loop every 6 hours
scheduleDaily(3,  nightlyConsolidation);
scheduleDaily(9,  learningLoop);
scheduleDaily(15, learningLoop);
scheduleDaily(21, learningLoop);

// ── http-proxy passthrough ────────────────────────────────────────────────────
const httpProxy = require('/hostinger/node_modules/http-proxy/index.js');
const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${CORE_PORT}` });
proxy.on('error', (_err, _req, res) => {
  if (res && !res.headersSent) { res.writeHead(502); res.end('core unavailable'); }
});

await new Promise(r => setTimeout(r, 1800));

// ── Main HTTP server ──────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url    = req.url ?? '/';
  const base   = url.split('?')[0];
  const method = (req.method ?? 'GET').toUpperCase();

  // GET /memory[?agent_id=x]
  if (base === '/memory' && method === 'GET') {
    try {
      const params = new URL(url, 'http://x').searchParams;
      const agentId = params.get('agent_id') || null;
      const rows = await memList(agentId, {
        user_id: params.get('user_id') || undefined,
        org_id: params.get('org_id') || undefined,
        project_id: params.get('project_id') || undefined,
        chat_id: params.get('chat_id') || undefined,
      });
      if (rows !== null) return sendJson(res, rows);
    } catch (e) { console.error('[mem-proxy] GET /memory', e.message); }
    return proxy.web(req, res);
  }

  // GET /api/memory/health
  if ((base === '/api/memory/health' || base === '/memory/health') && method === 'GET') {
    try {
      let vectorAvailable = false;
      let lastWrite = null;
      let lastRetrieval = null;
      let activeScopes = [];
      let memoryCount = 0;
      if (pg) {
        const ext = await pg.query(`SELECT 1 FROM pg_extension WHERE extname='vector'`);
        vectorAvailable = Boolean(ext.rowCount);
        const write = await pg.query(`SELECT updated FROM agent_memory ORDER BY updated DESC LIMIT 1`);
        lastWrite = write.rows[0]?.updated ?? null;
        const count = await pg.query(`SELECT count(*)::int AS count FROM agent_memory`);
        memoryCount = count.rows[0]?.count ?? 0;
        const scopes = await pg.query(`
          SELECT DISTINCT scope FROM (
            SELECT scope FROM agent_memory WHERE scope IS NOT NULL
            UNION SELECT 'chat' FROM agent_memory WHERE chat_id IS NOT NULL
            UNION SELECT 'project' FROM agent_memory WHERE project_id IS NOT NULL
            UNION SELECT 'org' FROM agent_memory WHERE org_id IS NOT NULL
            UNION SELECT 'user' FROM agent_memory WHERE user_id IS NOT NULL
            UNION SELECT 'agent' FROM agent_memory WHERE agent_id IS NOT NULL
          ) s ORDER BY scope
        `);
        activeScopes = scopes.rows.map(r => r.scope).filter(Boolean);
      }
      const probe = await embed(['memory health check']);
      lastRetrieval = new Date().toISOString();
      return sendJson(res, {
        database_connected: Boolean(pg),
        vector_extension_available: vectorAvailable,
        memory_plugin_loaded: true,
        redis_connected: Boolean(redis),
        embeddings_working: Array.isArray(probe?.[0]) && probe[0].length === VOYAGE_DIMS,
        memory_count: memoryCount,
        last_memory_write: lastWrite,
        last_memory_retrieval: lastRetrieval,
        active_scopes: activeScopes,
      });
    } catch (e) {
      return sendJson(res, 500, { database_connected: Boolean(pg), embeddings_working: false, error: e.message });
    }
  }

  // POST /memory
  if (base === '/memory' && method === 'POST') {
    try {
      const b = await readBody(req);
      if (!b.key) return sendJson(res, 400, { message: 'key required' });
      if (pg || redis) {
        const rec = await memUpsert(b);
        fetch(`http://127.0.0.1:${CORE_PORT}/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
            ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
          body: JSON.stringify(rec),
        }).catch(() => {});
        return sendJson(res, 201, rec);
      }
    } catch (e) { console.error('[mem-proxy] POST /memory', e.message); }
    return proxy.web(req, res);
  }

  // PATCH /memory/:key
  if (base.startsWith('/memory/') && method === 'PATCH') {
    try {
      const key = decodeURIComponent(base.slice('/memory/'.length));
      const b   = await readBody(req);
      if (pg || redis) {
        const rec = await memPatch(key, b);
        if (rec) return sendJson(res, rec);
      }
    } catch (e) { console.error('[mem-proxy] PATCH /memory', e.message); }
    return proxy.web(req, res);
  }

  // DELETE /memory/:key
  if (base.startsWith('/memory/') && method === 'DELETE') {
    try {
      const key = decodeURIComponent(base.slice('/memory/'.length));
      const ok  = await memDelete(key);
      if (ok) return sendJson(res, { ok: true });
    } catch (e) { console.error('[mem-proxy] DELETE /memory', e.message); }
    return proxy.web(req, res);
  }

  // GET /api/memory/search?q=...  — vector similarity via Voyage + pgvector
  if (base === '/api/memory/search' && method === 'GET') {
    try {
      const params = new URL(url, 'http://x').searchParams;
      const q     = params.get('q') ?? '';
      const limit = parseInt(params.get('limit') ?? '20');
      if (q) return sendJson(res, await memSearch(q, limit, {
        agent_id: params.get('agent_id') || undefined,
        user_id: params.get('user_id') || undefined,
        org_id: params.get('org_id') || undefined,
        project_id: params.get('project_id') || undefined,
        chat_id: params.get('chat_id') || undefined,
      }));
    } catch (e) { console.error('[mem-proxy] /api/memory/search', e.message); }
    return sendJson(res, []);
  }

  // POST /chat/send — retrieve scoped memory and store only durable facts
  if ((base === '/chat/send' || base === '/chat') && method === 'POST') {
    try {
      const b = await readBody(req);
      const message = String(b.message || '');
      const agent = b.agent_id || b.agent || 'cash';
      const model = b.model || 'openai/gpt-5.5';
      const scope = {
        agent_id: agent,
        user_id: b.user_id || b.userId || 'user',
        org_id: b.org_id || b.orgId || null,
        project_id: b.project_id || b.projectId || null,
        chat_id: b.chat_id || b.chatId || b.threadId || 'default',
      };
      const memories = message.trim() ? await memSearch(message, 6, scope).catch(() => []) : [];
      const contextText = memories.length
        ? `\n\nScoped memory used:\n${memories.slice(0, 4).map(m => `- ${m.preview || m.content}`).join('\n')}`
        : '';
      const stored = [];
      if (shouldStoreProxyMemory(message)) {
        const classified = classifyProxyMemory(message);
        const rec = await memUpsert({
          key: `chat.${scope.chat_id}.${Date.now()}`,
          scope: scope.project_id ? 'project' : scope.org_id ? 'org' : 'user',
          type: classified.type,
          agent_id: agent,
          user_id: scope.user_id,
          org_id: scope.org_id,
          project_id: scope.project_id,
          chat_id: scope.chat_id,
          category: classified.category,
          source: 'chat-send',
          importance_score: classified.importance_score,
          confidence_score: classified.confidence_score,
          expiration_policy: classified.expiration_policy,
          preview: message.slice(0, 160),
          content: message,
        });
        stored.push(rec);
      }
      const reply = {
        id: randomUUID(),
        role: 'assistant',
        author: agent,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        threadId: scope.chat_id,
        agent,
        model,
        memoryScope: scope.project_id ? 'project' : scope.org_id ? 'org' : 'user',
        text: `${agent} received: ${message}. Retrieved ${memories.length} scoped memor${memories.length === 1 ? 'y' : 'ies'} before responding.${contextText}`,
        memoryContext: memories,
      };
      if ((req.headers.accept || '').includes('text/event-stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const token of reply.text.split(/(\s+)/)) {
          res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
          await new Promise(r => setTimeout(r, 8));
        }
        res.end(`data: ${JSON.stringify({ done: true, message: reply, memory: stored, memoryContext: memories })}\n\n`);
        return;
      }
      return sendJson(res, { message: reply, memory: stored, memoryContext: memories });
    } catch (e) {
      console.error('[mem-proxy] /chat/send', e.message);
      return sendJson(res, 500, { error: e.message });
    }
  }

  // POST /api/memory/pipeline  — manual trigger for learning loop
  if (base === '/api/memory/pipeline' && method === 'POST') {
    try {
      const b = await readBody(req);
      const task = b.task ?? 'learn';
      if (task === 'consolidate') nightlyConsolidation().catch(() => {});
      else learningLoop().catch(() => {});
      return sendJson(res, { ok: true, task });
    } catch (e) { return sendJson(res, { ok: false, error: e.message }); }
  }

  // Passthrough
  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => proxy.ws(req, socket, head));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mem-proxy] :${PORT} → core :${CORE_PORT}  redis=${!!redis}  pg=${!!pg}  voyage=${!!VOYAGE_API_KEY}  deepseek=${!!OPENROUTER_KEY}`);
});
