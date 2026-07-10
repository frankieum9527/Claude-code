import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { teamRoutes } from './routes/teams.js';
import { meRoutes } from './routes/me.js';
import { icsRoutes } from './routes/ics.js';
import { submissionRoutes } from './routes/submissions.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  // Browser clients (Expo web, future coach dashboard). Auth is per-request
  // (bearer/x-user-id), so a permissive origin is fine.
  app.register(cors, { origin: true });

  // Video uploads arrive as raw streams; hand them to the route unbuffered.
  app.addContentTypeParser(
    ['application/octet-stream', 'video/mp4', 'video/quicktime'],
    (_req, payload, done) => done(null, payload),
  );

  app.get('/health', async () => ({ ok: true, service: 'athlete-guide-api' }));

  app.register(authRoutes);
  app.register(teamRoutes);
  app.register(meRoutes);
  app.register(icsRoutes);
  app.register(submissionRoutes);

  return app;
}
