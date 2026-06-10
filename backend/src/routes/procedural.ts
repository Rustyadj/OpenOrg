import { FastifyPluginAsync } from 'fastify';
import { extractProcedure, getProcedure, listProcedures, saveProcedure, updateProcedureOutcome } from '../services/procedural.js';

const proceduralRoutes: FastifyPluginAsync = async (app) => {
  app.post('/procedural/extract', async (request) => {
    const procedure = extractProcedure(request.body as any);
    const saved = await saveProcedure(procedure);
    return { procedure, saved };
  });

  app.get('/procedural', async () => listProcedures());

  app.get('/procedural/:name', async (request, reply) => {
    const proc = await getProcedure((request.params as any).name);
    if (!proc) return reply.code(404).send({ error: 'not_found' });
    return proc;
  });

  app.patch('/procedural/:name/outcome', async (request, reply) => {
    const body = request.body as any;
    const proc = await updateProcedureOutcome((request.params as any).name, Boolean(body.success));
    if (!proc) return reply.code(404).send({ error: 'not_found' });
    return proc;
  });
};

export default proceduralRoutes;
