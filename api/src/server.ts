import { createApp } from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/client.js';
import { logger } from './shared/logger.js';

/**
 * HTTP entrypoint. Does NOT run migrations and does NOT poll the outbox — those are the
 * worker's job (worker.ts), running as a separate process from the same compiled domain code
 * (TRD §1: "a separately running durable worker using the same domain services"). Keeping the
 * request-serving process free of background polling keeps its restart/scaling behavior
 * simple and avoids duplicate job claims across horizontally scaled API replicas.
 */
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api server listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    closePool()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'error closing database pool during shutdown');
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
