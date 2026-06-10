import { FastifyPluginAsync } from 'fastify';
import {
  checkZombie,
  getAgent,
  getPriorityQueue,
  heartbeat,
  hibernateAgent,
  recordTokenUsage,
  registerAgent,
  wakeAgent,
} from '../services/resources.js';

const resourcesRoutes: FastifyPluginAsync = async (app) => {
  app.post('/resources/agents', async (request) => {
    const body = request.body as any;
    const agentId = body.agent_id ?? body.agentId;
    return registerAgent(agentId, body.config ?? body);
  });

  app.post('/resources/agents/:id/heartbeat', async (request, reply) => {
    const agent = await heartbeat((request.params as any).id);
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    return agent;
  });

  app.post('/resources/agents/:id/tokens', async (request, reply) => {
    const agent = await recordTokenUsage((request.params as any).id, Number((request.body as any).tokens));
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    return agent;
  });

  app.post('/resources/agents/:id/hibernate', async (request, reply) => {
    const agent = await hibernateAgent((request.params as any).id);
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    return agent;
  });

  app.post('/resources/agents/:id/wake', async (request, reply) => {
    const agent = await wakeAgent((request.params as any).id);
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    return agent;
  });

  app.get('/resources/agents', async () => getPriorityQueue());

  app.get('/resources/agents/:id', async (request, reply) => {
    const agent = await getAgent((request.params as any).id);
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    return agent;
  });

  app.post('/resources/sweep', async () => checkZombie());
};

export default resourcesRoutes;
