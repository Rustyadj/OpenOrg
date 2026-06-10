import { FastifyPluginAsync } from 'fastify';
import { getLessonsByAgent, getRecentLessons, reviewOutcome } from '../services/learning.js';

const learningRoutes: FastifyPluginAsync = async (app) => {
  app.post('/learning/review', async (request, reply) => {
    const body = request.body as any;
    try {
      const result = await reviewOutcome(body.action, body.outcome, body.context ?? {}, body.agent_id);
      return result ?? null;
    } catch (err: any) {
      // LLM unavailable — degrade gracefully rather than 500
      if (err?.status === 401 || err?.status === 429 || err?.code === 'invalid_api_key') {
        return reply.code(503).send({ error: 'llm_unavailable', message: 'Learning loop requires a valid OPENAI_API_KEY' });
      }
      throw err;
    }
  });

  app.get('/learning/lessons', async (request) => {
    const query = request.query as any;
    if (query.agent_id) return getLessonsByAgent(query.agent_id);
    return getRecentLessons(Number(query.limit ?? 20));
  });
};

export default learningRoutes;
