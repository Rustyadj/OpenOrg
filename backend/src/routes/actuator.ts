import { FastifyPluginAsync } from 'fastify';
import {
  assignSkillToAgent,
  getAgentSkillSummary,
  getAgentSkills,
  getSkillActivations,
  recordSkillOutcome,
  removeSkillFromAgent,
} from '../services/actuator.js';

const actuatorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/actuator/:agentId', async (request) => {
    return getAgentSkillSummary((request.params as any).agentId);
  });

  app.get('/actuator/:agentId/context', async (request) => {
    const params = request.params as any;
    const query = request.query as any;
    return getAgentSkills(params.agentId, {
      task_context: query.task_context,
      max_tokens: query.max_tokens === undefined ? 500 : Number(query.max_tokens),
    });
  });

  app.post('/actuator/:agentId/skills', async (request, reply) => {
    const params = request.params as any;
    const body = request.body as any;
    try {
      await assignSkillToAgent(params.agentId, body.skill_name, body.version === undefined ? undefined : Number(body.version), Number(body.priority ?? 0));
      return { ok: true };
    } catch (error: any) {
      return reply.code(404).send({ error: error.message });
    }
  });

  app.delete('/actuator/:agentId/skills/:skillName', async (request) => {
    const params = request.params as any;
    await removeSkillFromAgent(params.agentId, params.skillName);
    return { ok: true };
  });

  app.post('/actuator/:agentId/outcome', async (request) => {
    const params = request.params as any;
    const body = request.body as any;
    await recordSkillOutcome(params.agentId, body.skill_name, Boolean(body.success), body.feedback);
    return { ok: true };
  });

  app.get('/actuator/:agentId/activations', async (request) => {
    const params = request.params as any;
    const query = request.query as any;
    return getSkillActivations(params.agentId, Number(query.limit ?? 20));
  });
};

export default actuatorRoutes;
