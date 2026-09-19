import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: append-only redacted action metadata and time-boxed operator support grants.
 * Governed by TRD §2 (Operator/audit row) and §3 (platform support); Data-Model §4.
 *
 * `audit_event` never stores a full before/after payload of sensitive data — only a
 * `redactedSummary` safe to display to the tenant owner. `support_grant` is the ONLY path by
 * which a Drezivo operator identity (not a tenant member) can touch tenant data, and it is
 * reason-coded, time-limited, and separately permissioned for private evidence access.
 */

export const auditEvent = pgTable('audit_event', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  actorKey: text('actor_key').notNull(),
  supportGrantId: uuid('support_grant_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  redactedSummary: jsonb('redacted_summary').$type<Record<string, unknown>>().notNull(),
  requestId: text('request_id').notNull(),
  ...timestamps,
}, (table) => [
  index('audit_event_tenant_action_created_idx').on(table.tenantId, table.action, table.createdAt),
  index('audit_event_tenant_entity_created_idx').on(table.tenantId, table.entityType, table.createdAt),
]);

export const supportGrant = pgTable('support_grant', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  operatorSubject: text('operator_subject').notNull(),
  grantedBy: text('granted_by').notNull(),
  permissionCodes: jsonb('permission_codes').$type<string[]>().notNull().default([]),
  reason: text('reason').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [index('support_grant_tenant_subject_created_idx').on(table.tenantId, table.operatorSubject, table.createdAt)]);
