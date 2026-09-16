import { config } from './config/index.js';
import { closePool } from './db/client.js';
import { outboxDispatcher } from './worker/handlers/outbox-dispatcher.js';
import { expireDueHoldsForAllTenants } from './worker/handlers/hold-expirer.js';
import { WorkerRunner } from './worker/runner.js';
import { logger } from './shared/logger.js';

/**
 * Durable worker entrypoint — a SEPARATE PROCESS from server.ts, sharing the same compiled
 * domain/service code and config validation (TRD §1). Deployed as its own container from the
 * same image (see Dockerfile / CONTRIBUTING.md §8: "two deploy artifacts ... from one image").
 *
 * Connects to the database as the `drezivo_worker` role (0008_rls_policies.sql), not
 * `drezivo_app` — in production this means `DATABASE_URL` for this process embeds the
 * `drezivo_worker` credentials, distinct from the API server's `drezivo_app` credentials, even
 * though both read the same `DATABASE_URL` config key. This scaffold does not add a second env
 * var for that; it is a deployment-time choice of which connection string each process is
 * given, not a code branch.
 */
const runner = new WorkerRunner({
  'reservation.held': outboxDispatcher,
  'reservation.confirmed': outboxDispatcher,
  'reservation.hold_expired': outboxDispatcher,
});

let holdExpirySweepTimer: NodeJS.Timeout | undefined;

function scheduleHoldExpirySweep(): void {
  holdExpirySweepTimer = setInterval(() => {
    expireDueHoldsForAllTenants().catch((error: unknown) => {
      logger.error({ err: error }, 'hold-expiry sweep failed; will retry on next interval');
    });
  }, config.WORKER_POLL_INTERVAL_MS);
}

logger.info({ enabled: config.WORKER_ENABLED }, 'worker process starting');
if (!config.WORKER_ENABLED) {
  logger.warn('worker disabled by configuration; no jobs will be claimed');
} else {
  scheduleHoldExpirySweep();
}
if (config.WORKER_ENABLED) runner.start().catch((error: unknown) => {
  logger.error({ err: error }, 'worker runner crashed');
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  runner.stop();
  if (holdExpirySweepTimer) {
    clearInterval(holdExpirySweepTimer);
  }
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
