import { FastifyPluginAsync } from 'fastify';
import { createRelationship, deleteRelationship, findRelated, getSubgraph } from '../services/graph.js';

const graphRoutes: FastifyPluginAsync = async (app) => {
  app.post('/graph/relate', async (request, reply) => {
    const body = request.body as any;
    try {
      return await createRelationship(body.from, body.fromLabel, body.to, body.toLabel, body.relType, body.props ?? {});
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.get('/graph/:nodeId', async (request) => {
    const { nodeId } = request.params as any;
    const { depth } = request.query as any;
    return getSubgraph(nodeId, Number(depth ?? 2));
  });

  app.get('/graph/:nodeId/related', async (request, reply) => {
    const { nodeId } = request.params as any;
    const { relType } = request.query as any;
    try {
      return await findRelated(nodeId, relType);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.delete('/graph/relate', async (request, reply) => {
    const body = request.body as any;
    try {
      return { deleted: await deleteRelationship(body.from, body.to, body.relType) };
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};

export default graphRoutes;
