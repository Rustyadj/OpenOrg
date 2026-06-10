import { FastifyPluginAsync } from 'fastify';
import { compressBatch, compressMemory, getCompressionStats } from '../services/compression.js';

const compressionRoutes: FastifyPluginAsync = async (app) => {
  app.post('/compression/compress/:id', async (request) => {
    const result = await compressMemory((request.params as any).id);
    return result ?? { skipped: true, reason: 'not_found' };
  });

  app.post('/compression/batch', async (request) => {
    return compressBatch((request.body as any) ?? {});
  });

  app.get('/compression/stats', async () => {
    return getCompressionStats();
  });
};

export default compressionRoutes;
