import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: the transactional outbox, the global webhook inbox, notification delivery state, and
 * the idempotency record store. Governed by TRD §2 (Notifications/jobs row) and §8 (jobs,
 * notifications, integration safety); Data-Model §8.
 *
 * `outbox_event` rows are written in the SAME transaction as the business event that caused
 * them (see reservations.service.ts confirm/hold flows) — never as a fire-and-forget
 * side effect after commit. `worker/runner.ts` claims due rows with `SKIP LOCKED`, stamps a
 * lease token/deadline, and only a worker still holding that exact token may mark a row
 * succeeded — a crashed worker's lease simply expires and is reclaimed.
 *
 * `idempotency_record` lives here because it is infrastructure every module's mutating routes
 * share through `middleware/idempotency.ts`, not a business concept any single domain module
 * owns.
 */

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'leased', 'succeeded', 'dead']);
export const webhookStatusEnum = pgEnum('webhook_status', ['received', 'processed', 'rejected']);
export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'provider_accepted',
  'delivered',
  'bounced',
  'failed',
]);
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'succeeded', 'failed']);

/** Stable `dedupeKey` survives retries; external delivery downstream remains at-least-once by design (TRD §8). */
export const outboxEvent = pgTable(
  'outbox_event',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    safeLastError: text('safe_last_error'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('outbox_event_tenant_dedupe_key_key').on(table.tenantId, table.dedupeKey),
    index('outbox_event_tenant_status_available_idx').on(table.tenantId, table.status, table.availableAt),
  ],
);

/** Global (pre-tenant) table — a provider webhook is authenticated by signature, not by a tenant a client claims. */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    ...idColumn,
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    /** Canonical contract event name; nullable only for legacy pre-TBF-022 rows. */
    eventType: text('event_type'),
    payloadDigest: text('payload_digest').notNull(),
    safePayload: jsonb('safe_payload').$type<Record<string, unknown>>().notNull(),
    status: webhookStatusEnum('status').notNull().default('received'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('webhook_inbox_provider_event_key').on(table.provider, table.providerEventId)],
);

export const notificationDelivery = pgTable('notification_delivery', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  outboxId: uuid('outbox_id')
    .notNull()
    .references(() => outboxEvent.id),
  channel: text('channel').notNull(),
  templateVersion: text('template_version').notNull(),
  status: notificationStatusEnum('status').notNull().default('queued'),
  providerMessageId: text('provider_message_id'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  ...timestamps,
});

/** Scoped by (tenant, principal, operation, key) — see middleware/idempotency.ts for the canonical-hash comparison this table backs. */
export const idempotencyRecord = pgTable(
  'idempotency_record',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    principalKey: text('principal_key').notNull(),
    operation: text('operation').notNull(),
    intentKey: text('intent_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('in_progress'),
    resourceId: uuid('resource_id'),
    responseCode: integer('response_code'),
    safeResponse: jsonb('safe_response').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idempotency_record_scope_key').on(
      table.tenantId,
      table.principalKey,
      table.operation,
      table.intentKey,
    ),
  ],
);

export const importJobStatusEnum = pgEnum('import_job_status', ['previewed', 'committed', 'failed']);
export const exportJobStatusEnum = pgEnum('export_job_status', ['pending', 'completed', 'failed']);

export const importJob = pgTable('import_job', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  fileId: uuid('file_id').notNull(),
  status: importJobStatusEnum('status').notNull().default('previewed'),
  contentHash: text('content_hash').notNull(),
  intentKey: text('intent_key').notNull(),
  resultSummary: jsonb('result_summary').$type<Record<string, unknown>>(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
});

export const exportJob = pgTable('export_job', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  scopeSnapshot: jsonb('scope_snapshot').$type<Record<string, unknown>>().notNull(),
  status: exportJobStatusEnum('status').notNull().default('pending'),
  resultFileId: uuid('result_file_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
});
