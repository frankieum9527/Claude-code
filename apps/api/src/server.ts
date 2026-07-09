import Fastify from 'fastify';
import { authRoutes } from './routes/auth.js';
import { teamRoutes } from './routes/teams.js';
import { meRoutes } from './routes/me.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ ok: true, service: 'athlete-guide-api' }));

  app.register(authRoutes);
  app.register(teamRoutes);
  app.register(meRoutes);

  return app;
}
