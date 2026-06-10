import { query } from '../db/client.js';

async function latestSkill(skillName: string) {
  const result = await query(
    'SELECT * FROM skill_versions WHERE skill_name = $1 ORDER BY version DESC LIMIT 1',
    [skillName],
  );
  return result.rows[0] ?? null;
}

export async function trackOutcome(agentId: string, skillName: string, success: boolean, feedback?: string) {
  // Ensure skill record exists
  let skill = await latestSkill(skillName);
  if (!skill) {
    const created = await query(
      `INSERT INTO skill_versions(skill_name, version, definition, success_rate, changelog, approved)
       VALUES ($1, 1, '{}'::jsonb, $2, 'auto-created', true)
       RETURNING *`,
      [skillName, success ? 1 : 0],
    );
    skill = created.rows[0];
  }

  // Record outcome in separate table (no array bloat)
  await query(
    `INSERT INTO skill_outcomes(skill_name, version, agent_id, success, feedback)
     VALUES ($1,$2,$3,$4,$5)`,
    [skillName, skill.version, agentId, success, feedback ?? null],
  );

  // Update rolling success_rate from actual outcome table (not in-memory calculation)
  const updated = await query(
    `UPDATE skill_versions
     SET success_rate = (
       SELECT ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END)::numeric, 4)
       FROM skill_outcomes WHERE skill_name = $1
     )
     WHERE skill_name = $1 AND version = $2
     RETURNING *`,
    [skillName, skill.version],
  );
  return updated.rows[0];
}

export async function detectRegressions(agentId: string) {
  // Single query: compare 7-day vs prior-7-day per skill — no full table scan in JS
  const result = await query(
    `SELECT
       skill_name,
       ROUND(AVG(CASE WHEN success AND created_at > NOW() - INTERVAL '7 days' THEN 1.0 ELSE 0.0 END)::numeric, 4) AS recent_rate,
       ROUND(AVG(CASE WHEN success AND created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days' THEN 1.0 ELSE 0.0 END)::numeric, 4) AS prior_rate,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS recent_count,
       COUNT(*) FILTER (WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days') AS prior_count
     FROM skill_outcomes
     WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '14 days'
     GROUP BY skill_name
     HAVING
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') >= 3
       AND COUNT(*) FILTER (WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days') >= 3`,
    [agentId],
  );
  return result.rows.filter(r => Number(r.recent_rate) < Number(r.prior_rate) - 0.1);
}

export async function proposeSkillUpdate(
  skillName: string,
  definition: object,
  changelog: string,
  proposedBy: string,
) {
  const current = await latestSkill(skillName);
  const version = (current?.version ?? 0) + 1;
  const result = await query(
    `INSERT INTO skill_versions(skill_name, version, definition, changelog, approved)
     VALUES ($1,$2,$3::jsonb,$4,false)
     RETURNING *`,
    [skillName, version, JSON.stringify(definition), `${changelog} (proposed by ${proposedBy})`],
  );
  return result.rows[0];
}

export async function approveSkillVersion(skillName: string, version: number, approvedBy: string) {
  const result = await query(
    `UPDATE skill_versions
     SET approved = true, approved_by = $3, approved_at = NOW()
     WHERE skill_name = $1 AND version = $2
     RETURNING *`,
    [skillName, version, approvedBy],
  );
  return result.rows[0] ?? null;
}

export async function rollbackSkill(skillName: string, targetVersion: number) {
  // Mark current as rolled back, mark target as active approved version
  await query(
    `UPDATE skill_versions SET rolled_back = true WHERE skill_name = $1 AND version > $2`,
    [skillName, targetVersion],
  );
  const result = await query(
    `UPDATE skill_versions SET approved = true, rolled_back = false WHERE skill_name = $1 AND version = $2 RETURNING *`,
    [skillName, targetVersion],
  );
  return result.rows[0] ?? null;
}

export async function getSkillHistory(skillName: string) {
  const versions = await query(
    `SELECT * FROM skill_versions WHERE skill_name = $1 ORDER BY version DESC`,
    [skillName],
  );
  // Attach recent outcome counts without joining the full history
  const stats = await query(
    `SELECT version,
       COUNT(*) AS total_runs,
       ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END)::numeric, 4) AS success_rate
     FROM skill_outcomes WHERE skill_name = $1 GROUP BY version`,
    [skillName],
  );
  const statsMap = Object.fromEntries(stats.rows.map(r => [r.version, r]));
  return versions.rows.map(v => ({ ...v, outcome_stats: statsMap[v.version] ?? null }));
}
