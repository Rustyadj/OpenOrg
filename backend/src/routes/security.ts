import { FastifyReply, FastifyRequest } from 'fastify';

export async function requireSecurityToken(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.SECURITY_TOKEN ?? process.env.AUTH_TOKEN;
  if (!expected) return; // no token configured — allow in dev
  const provided = request.headers['x-security-token'] ?? request.headers['authorization']?.replace('Bearer ', '');
  if (provided !== expected) {
    return reply.code(403).send({ error: 'forbidden' });
  }
}

export const severities = ['critical', 'high', 'medium', 'low', 'info'];
