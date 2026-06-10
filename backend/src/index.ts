import { buildServer, initIntegrations } from './server.js';

const port = Number(process.env.MEMORY_SERVICE_PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const app = buildServer();
await initIntegrations();
await app.listen({ port, host });
