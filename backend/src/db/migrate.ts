import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, closeDb } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

async function migrate() {
  // Create tracking table if it doesn't exist
  await query(`CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const { rows: applied } = await query<{ filename: string }>('SELECT filename FROM _migrations');
  const done = new Set(applied.map(r => r.filename));

  const files = (await fs.readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (done.has(file)) {
      console.log(`skipped ${file} (already applied)`);
      continue;
    }
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await query(sql);
    await query('INSERT INTO _migrations(filename) VALUES ($1)', [file]);
    console.log(`applied ${file}`);
  }
}

migrate().finally(closeDb).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
