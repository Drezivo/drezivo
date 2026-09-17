import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { account } from './account.js';
import { idColumn, timestamps } from './_shared.js';

/**
 * Global records used while an account is being onboarded, before a tenant exists.
 *
 * The database migration owns the RLS policies and append-only privileges. These Drizzle
 * definitions intentionally mirror that SQL boundary; the repositories use the caller's
 * transaction client so claims, domain effects, and audit rows can commit together.
 */
export const bootstrapIdempotencyRecord = pgTable(
  'bootstrap_idempotency_record',
  {
    ...idColumn,
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    operation: text('operation').notNull(),
    intentKey: text('intent_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status').notNull().default('in_progress'),
    responseCode: integer('response_code'),
    safeResponse: jsonb('safe_response').$type<unknown>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('bootstrap_idempotency_record_scope_key').on(
      table.accountId,
      table.operation,
      table.intentKey,
    ),
    index('bootstrap_idempotency_record_expires_at_idx').on(table.expiresAt),
  ],
);

export const globalAuditEvent = pgTable(
  'global_audit_event',
  {
    ...idColumn,
    accountId: uuid('account_id').references(() => account.id),
    actorKind: text('actor_kind').notNull(),
    actorKey: text('actor_key').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    outcome: text('outcome').notNull(),
    redactedSummary: jsonb('redacted_summary').$type<unknown>().notNull(),
    requestId: text('request_id').notNull(),
    ...timestamps,
  },
  (table) => [
    index('global_audit_event_account_created_idx').on(table.accountId, table.createdAt),
    index('global_audit_event_entity_created_idx').on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
