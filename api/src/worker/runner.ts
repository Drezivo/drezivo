import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { config } from '../config/index.js';
import { pool } from '../db/client.js';
import { logger } from '../shared/logger.js';

export interface OutboxRow {
  id: string;
  tenant_id: string;
  dedupe_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  /** Set locally by `claimBatch` after a successful claim; verified before any terminal write so a lease loss never lets a stale worker mark a reclaimed row complete. */
  _leaseToken?: string;
}

export type EventHandler = (row: OutboxRow) => Promise<void>;

export interface DrainResult {
  processed: number;
  stoppedBy: 'empty' | 'budget' | 'stopped';
}

const BATCH_SIZE = 10;

/** Handler errors that cannot succeed on retry (malformed payload or permanently invalid state). */
export class PermanentOutboxError extends Error {
  readonly permanent = true;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}

/**
 * Lease-claim polling loop with bounded retry to a terminal state (TRD §8). Polling, not
 * `LISTEN`/`NOTIFY`, per TRD §9: "Polling, not session LISTEN, is the initial design" — pooled
 * runtime connections make holding a `LISTEN` session impractical, and polling is simple enough
 * to reason about under worker-outage tests (TRD §5 adversarial test 3).
 *
 * One claim transaction per batch: `FOR UPDATE SKIP LOCKED` lets multiple worker replicas poll
 * concurrently without claiming the same row twice, and the lease token/deadline mean a worker
 * that crashes mid-processing does not hold its claim forever — a later poll (by this or any
 * other replica) reclaims the row once `lease_until` has passed.
 */
export class WorkerRunner {
  private stopped = false;

  constructor(
    private readonly handlers: Record<string, EventHandler>,
    private readonly pollIntervalMs = config.WORKER_POLL_INTERVAL_MS,
    private readonly leaseSeconds = config.WORKER_LEASE_SECONDS,
    private readonly db: Pool = pool,
  ) {}

  async start(): Promise<void> {
    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'worker runner starting');
    while (!this.stopped) {
      const claimed = await this.claimBatch(BATCH_SIZE);
      if (claimed.length === 0) {
        await sleep(this.pollIntervalMs);
        continue;
      }
      for (const row of claimed) {
        await this.processOne(row);
      }
    }
  }

  /**
   * Run-once mode for a scheduled job: work through due rows until the queue is empty, the time
   * budget is spent, or `stop()` is called, then return so the process can exit. The budget and
   * stop checks sit between batches, so a claimed batch is always finished, never abandoned.
   * Overlapping runs are safe: `SKIP LOCKED` gives each run disjoint rows.
   */
  async drainOnce(options: { budgetMs: number; eventTypes?: readonly string[] }): Promise<DrainResult> {
    const startedAt = Date.now();
    let processed = 0;
    for (;;) {
      if (this.stopped) return { processed, stoppedBy: 'stopped' };
      if (Date.now() - startedAt >= options.budgetMs) return { processed, stoppedBy: 'budget' };
      const claimed = await this.claimBatch(BATCH_SIZE, options.eventTypes);
      if (claimed.length === 0) return { processed, stoppedBy: 'empty' };
      for (const row of claimed) {
        await this.processOne(row);
        processed += 1;
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async claimBatch(limit: number, eventTypes?: readonly string[]): Promise<OutboxRow[]> {
    const leaseToken = randomUUID();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `WITH due AS (
           SELECT id FROM outbox_event
           WHERE ((status = 'pending' AND available_at <= now())
               OR (status = 'leased' AND lease_until < now()))
             AND ($4::text[] IS NULL OR event_type = ANY($4::text[]))
           ORDER BY available_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox_event o
         SET status = 'leased', lease_token = $2, lease_until = now() + make_interval(secs => $3)
         FROM due
         WHERE o.id = due.id
         RETURNING o.id, o.tenant_id, o.dedupe_key, o.event_type, o.payload, o.attempts, o.max_attempts`,
        [limit, leaseToken, this.leaseSeconds, eventTypes ?? null],
      );
      await client.query('COMMIT');
      // Stamp the lease token onto each row locally so `complete`/`fail` below can verify it
      // still holds this exact lease before writing a terminal outcome.
      return rows.map((row) => ({ ...row, _leaseToken: leaseToken }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processOne(row: OutboxRow): Promise<void> {
    const handler = this.handlers[row.event_type];
    if (!handler) {
      logger.error({ eventType: row.event_type, outboxId: row.id }, 'no handler registered for event type');
      await this.markDead(row, 'no handler registered');
      return;
    }

    try {
      await handler(row);
      await this.complete(row);
    } catch (error) {
      await this.retryOrDie(row, error);
    }
  }

  private async complete(row: OutboxRow): Promise<void> {
    await this.db.query(
      `UPDATE outbox_event SET status = 'succeeded', completed_at = now()
       WHERE id = $1 AND lease_token = $2`,
      [row.id, row._leaseToken],
    );
  }

  private async retryOrDie(row: OutboxRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const safeMessage = error instanceof Error ? error.message : 'unknown error';
    const isPermanent = error instanceof PermanentOutboxError;
    logger.warn({ outboxId: row.id, attempts, error: safeMessage }, 'outbox handler failed');

    if (isPermanent || attempts >= row.max_attempts) {
      await this.markDead(row, safeMessage);
      logger.error({ outboxId: row.id, tenantId: row.tenant_id, eventType: row.event_type }, 'outbox event moved to dead-letter');
      return;
    }

    // Exponential backoff with jitter, bounded by max_attempts (TRD §8).
    const backoffSeconds = Math.min(2 ** attempts, 3600) + Math.random() * 5;
    await this.db.query(
      `UPDATE outbox_event
       SET status = 'pending', attempts = $2, safe_last_error = $3,
           available_at = now() + make_interval(secs => $4), lease_token = NULL, lease_until = NULL
       WHERE id = $1 AND lease_token = $5`,
      [row.id, attempts, safeMessage, backoffSeconds, row._leaseToken],
    );
  }

  private async markDead(row: OutboxRow, safeMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE outbox_event
          SET status = 'dead', attempts = $3, safe_last_error = $4,
              lease_token = NULL, lease_until = NULL
        WHERE id = $1 AND lease_token = $2`,
      [row.id, row._leaseToken, row.attempts + 1, safeMessage],
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
