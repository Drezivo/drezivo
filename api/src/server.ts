import { createApp } from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/client.js';
import { logger } from './shared/logger.js';
import { resolveWorkerEntry, startEmbeddedWorker, type EmbeddedWorkerHandle } from './worker/embedded.js';

/**
 * HTTP entrypoint. Does NOT run migrations and does NOT poll the outbox — those are the
 * worker's job (worker.ts), running as a separate process from the same compiled domain code
 * (TRD §1: "a separately running durable worker using the same domain services"). Keeping the
 * request-serving process free of background polling keeps its restart/scaling behavior
 * simple and avoids duplicate job claims across horizontally scaled API replicas.
 *
 * Pilot exception (EMBEDDED_WORKER=true): with no separate worker service, this process supervises
 * the same worker entrypoint as a child process under its own database role. Run ONE API instance
 * in that mode; outbox leases keep extra instances safe but wasteful.
 */
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api server listening');
});

if (!config.TURNSTILE_SECRET_KEY) {
  logger.warn('TURNSTILE_SECRET_KEY is not set; storefront guest submissions skip the Turnstile bot check');
}

const embeddedWorker: EmbeddedWorkerHandle | null =
  config.EMBEDDED_WORKER && config.WORKER_DATABASE_URL
    ? startEmbeddedWorker({ entry: resolveWorkerEntry(import.meta.url), workerDatabaseUrl: config.WORKER_DATABASE_URL })
    : null;

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');
  const workerStopped = embeddedWorker ? embeddedWorker.stop(signal) : Promise.resolve();
  server.close(() => {
    void workerStopped.then(() =>
      closePool()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          logger.error({ err: error }, 'error closing database pool during shutdown');
          process.exit(1);
        }),
    );
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
