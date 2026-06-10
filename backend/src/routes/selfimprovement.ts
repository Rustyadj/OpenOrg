import { FastifyPluginAsync } from 'fastify';
import {
  approveSkillVersion,
  detectRegressions,
  getSkillHistory,
  proposeSkillUpdate,
  rollbackSkill,
  trackOutcome,
} from '../services/selfimprovement.js';

// Accept both snake_case (API standard) and camelCase (legacy) field names
function field(body: any, ...keys: string[]): any {
  for (const k of keys) if (body[k] !== undefined) return body[k];
  return undefined;
}

const selfImprovementRoutes: FastifyPluginAsync = async (app) => {
  app.post('/self-improvement/outcome', async (request) => {
    const body = request.body as any;
    const agentId   = field(body, 'agent_id',   'agentId');
    const skillName = field(body, 'skill_name',  'skillName');
    return trackOutcome(agentId, skillName, Boolean(body.success), body.feedback);
  });

  app.get('/self-improvement/regressions/:agentId', async (request) =>
    detectRegressions((request.params as any).agentId),
  );

  app.post('/self-improvement/skills/propose', async (request) => {
    const body = request.body as any;
    const skillName   = field(body, 'skill_name',  'skillName');
    const proposedBy  = field(body, 'proposed_by', 'proposedBy');
    return proposeSkillUpdate(skillName, body.definition ?? {}, body.changelog ?? '', proposedBy);
  });

  app.post('/self-improvement/skills/approve', async (request, reply) => {
    const body = request.body as any;
    const skillName  = field(body, 'skill_name',  'skillName');
    const approvedBy = field(body, 'approved_by', 'approvedBy');
    const skill = await approveSkillVersion(skillName, Number(body.version), approvedBy);
    if (!skill) return reply.code(404).send({ error: 'not_found' });
    return skill;
  });

  app.post('/self-improvement/skills/rollback', async (request, reply) => {
    const body = request.body as any;
    const skillName     = field(body, 'skill_name',     'skillName');
    const targetVersion = field(body, 'target_version', 'targetVersion');
    const skill = await rollbackSkill(skillName, Number(targetVersion));
    if (!skill) return reply.code(404).send({ error: 'not_found' });
    return skill;
  });

  app.get('/self-improvement/skills/:name/history', async (request) =>
    getSkillHistory((request.params as any).name),
  );
};

export default selfImprovementRoutes;
