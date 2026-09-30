import { config } from './config/index.js';
import { closePool } from './db/client.js';
import { ACKNOWLEDGED_DOMAIN_EVENTS, acknowledgeDomainEvent } from './worker/handlers/domain-events.js';
import { expireDueHoldsForAllTenants } from './worker/handlers/hold-expirer.js';
import { handleTenantBootstrapped } from './worker/handlers/tenant-bootstrap.js';
import { reconcileDueSubscriptionsForAllTenants } from './worker/handlers/subscription-lifecycle.js';
import { handleMembershipInvitationDispatch } from './modules/membership-invitations/membership-invitations.dispatcher.js';
import { reconcileDueClerkWebhooks } from './worker/handlers/clerk-webhook-reconciler.js';
import { cleanupAbandonedClerkOrganizations } from './worker/handlers/clerk-organization-cleanup.js';
import { promoteElapsedRecoveryReadinessForAllTenants } from './worker/handlers/recovery-readiness.js';
import { WorkerRunner, type EventHandler } from './worker/runner.js';
import { createEmailDeliveryHandler } from './worker/handlers/email-delivery.js';
import { EMAIL_EVENT_TYPE } from './modules/notifications/email-notifications.js';
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
 *
 * WORKER_MODE=continuous runs forever (polling + interval sweeps). WORKER_MODE=drain runs one
 * pass and exits, for a scheduled job; see docs/runbooks/worker-cloud-run.md.
 */
const handlers: Record<string, EventHandler> = {
  'tenant.bootstrapped': handleTenantBootstrapped,
  [EMAIL_EVENT_TYPE]: createEmailDeliveryHandler(),
  'clerk.invitation.dispatch_requested': handleMembershipInvitationDispatch,
  'clerk.invitation.revoke_requested': handleMembershipInvitationDispatch,
  ...Object.fromEntries(ACKNOWLEDGED_DOMAIN_EVENTS.map((eventType) => [eventType, acknowledgeDomainEvent])),
};
const runner = new WorkerRunner(handlers);

interface Sweep {
  name: string;
  run: () => Promise<unknown>;
  intervalMs: number;
  /** Included in WORKER_DRAIN_SCOPE=fast: an expired hold keeps blocking its garment until swept. */
  fast?: true;
}

const SWEEPS: readonly Sweep[] = [
  { name: 'hold expiry', run: expireDueHoldsForAllTenants, intervalMs: config.WORKER_POLL_INTERVAL_MS, fast: true },
  { name: 'subscription lifecycle', run: reconcileDueSubscriptionsForAllTenants, intervalMs: config.WORKER_POLL_INTERVAL_MS },
  { name: 'Clerk webhook reconciliation', run: reconcileDueClerkWebhooks, intervalMs: config.WORKER_POLL_INTERVAL_MS },
  { name: 'Clerk organization cleanup', run: cleanupAbandonedClerkOrganizations, intervalMs: config.WORKER_POLL_INTERVAL_MS },
  {
    name: 'recovery readiness',
    run: promoteElapsedRecoveryReadinessForAllTenants,
    intervalMs: Math.max(config.WORKER_POLL_INTERVAL_MS, 60_000),
  },
];

function runContinuously(): void {
  const timers = SWEEPS.map((sweep) =>
    setInterval(() => {
      sweep.run().catch((error: unknown) => {
        logger.error({ err: error, sweep: sweep.name }, 'sweep failed; will retry on next interval');
      });
    }, sweep.intervalMs),
  );
  runner.start().catch((error: unknown) => {
    logger.error({ err: error }, 'worker runner crashed');
    process.exit(1);
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'worker shutting down');
    runner.stop();
    timers.forEach(clearInterval);
    await closePool();
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/**
 * One pass for a scheduled job. A failed sweep is logged and the remaining work still runs, but
 * the process exits non-zero so the scheduler records the execution as failed.
 */
async function runOnce(): Promise<number> {
  // A job timeout sends SIGTERM: finish the batch in hand, claim nothing new, and exit.
  process.on('SIGTERM', () => runner.stop());
  process.on('SIGINT', () => runner.stop());

  const fast = config.WORKER_DRAIN_SCOPE === 'fast';
  const sweepFailures: string[] = [];
  for (const sweep of SWEEPS.filter((candidate) => !fast || candidate.fast)) {
    try {
      await sweep.run();
    } catch (error) {
      sweepFailures.push(sweep.name);
      logger.error({ err: error, sweep: sweep.name }, 'sweep failed during drain');
    }
  }
  const result = await runner.drainOnce({
    budgetMs: config.WORKER_DRAIN_BUDGET_MS,
    ...(fast ? { eventTypes: [EMAIL_EVENT_TYPE] } : {}),
  });
  logger.info({ scope: config.WORKER_DRAIN_SCOPE, ...result, sweepFailures }, 'worker drain finished');
  return sweepFailures.length === 0 ? 0 : 1;
}

logger.info({ enabled: config.WORKER_ENABLED, mode: config.WORKER_MODE }, 'worker process starting');
if (!config.WORKER_ENABLED) {
  logger.warn('worker disabled by configuration; no jobs will be claimed');
  if (config.WORKER_MODE === 'drain') process.exit(0);
} else if (config.WORKER_MODE === 'continuous') {
  runContinuously();
} else {
  void runOnce()
    .catch((error: unknown) => {
      logger.error({ err: error }, 'worker drain crashed');
      return 1;
    })
    .then(async (code) => {
      await closePool().catch(() => undefined);
      process.exit(code);
    });
}
