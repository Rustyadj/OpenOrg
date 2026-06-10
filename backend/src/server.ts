import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import graphRoutes from './routes/graph.js';
import proceduralRoutes from './routes/procedural.js';
import learningRoutes from './routes/learning.js';
import dreamingRoutes from './routes/dreaming.js';
import selfImprovementRoutes from './routes/selfimprovement.js';
import resourcesRoutes from './routes/resources.js';
import redTeamRoutes from './routes/redteam.js';
import blueTeamRoutes from './routes/blueteam.js';
import purpleTeamRoutes from './routes/purpleteam.js';
import governanceRoutes from './routes/governance.js';
import memoryRoutes from './routes/memory.js';
import memoryOsRoutes from './routes/memory-os.js';
import compressionRoutes from './routes/compression.js';
import actuatorRoutes from './routes/actuator.js';
import repoRoutes from './routes/repo.js';
import { initNeo4j } from './services/graph.js';
import { initDreamingJobs } from './jobs/dreaming.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors);
  app.register(helmet);

  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return;
    const token = process.env.AUTH_TOKEN ?? process.env.MEMORY_SERVICE_TOKEN;
    if (!token) return;
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(memoryRoutes);
  app.register(memoryOsRoutes);
  app.register(compressionRoutes);
  app.register(actuatorRoutes);
  app.register(repoRoutes);
  app.register(graphRoutes);
  app.register(proceduralRoutes);
  app.register(learningRoutes);
  app.register(dreamingRoutes);
  app.register(selfImprovementRoutes);
  app.register(resourcesRoutes);
  app.register(redTeamRoutes);
  app.register(blueTeamRoutes);
  app.register(purpleTeamRoutes);
  app.register(governanceRoutes);

  return app;
}

export async function initIntegrations() {
  await initNeo4j().catch((error) => {
    console.warn(`Neo4j init skipped: ${error.message}`);
  });
  await initDreamingJobs().catch((error) => {
    console.warn(`Dreaming jobs init skipped: ${error.message}`);
  });
}
