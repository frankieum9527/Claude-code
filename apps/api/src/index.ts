import { buildServer } from './server.js';
import { assertAuthConfigured } from './auth.js';
import { startIcsSyncScheduler } from './sync/scheduler.js';
import { sweepPendingAnalyses } from './ai/worker.js';

// Refuse to boot in production with the impersonable dev-stub auth.
assertAuthConfigured();

const port = Number(process.env.PORT ?? 3000);

const app = buildServer();

// Background calendar re-sync; set ICS_SYNC_INTERVAL_MINUTES=0 to disable
// (e.g. when running multiple API instances — only one should sync).
const syncMinutes = Number(process.env.ICS_SYNC_INTERVAL_MINUTES ?? 60);
if (syncMinutes > 0) {
  const stop = startIcsSyncScheduler({ intervalMs: syncMinutes * 60_000, logger: app.log });
  app.addHook('onClose', async () => stop());
}

// Draft feedback for any videos uploaded while the server was down.
void sweepPendingAnalyses(app.log);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
