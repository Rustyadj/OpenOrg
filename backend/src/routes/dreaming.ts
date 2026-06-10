import { FastifyPluginAsync } from 'fastify';
import { getJobStatus, triggerDreamingJob } from '../jobs/dreaming.js';

const dreamingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dreaming/status', async () => getJobStatus());

  app.post('/dreaming/trigger/:jobName', async (request, reply) => {
    try {
      return await triggerDreamingJob((request.params as any).jobName);
    } catch (error: any) {
      return reply.code(404).send({ error: error.message });
    }
  });
};

export default dreamingRoutes;
