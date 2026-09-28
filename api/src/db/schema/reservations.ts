import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { physicalAsset, productVariant } from './catalogue.js';
import { paymentMethod, policySnapshot, storefront } from './storefront.js';
import { branch, membership } from './tenancy.js';
import { idColumn, timestamps, updatableTimestamps } from './_shared.js';

/**
 * Owns: reservation headers/lines, guest capability tokens, and append-only custody/
 * disruption facts. Governed by TRD §2 (Reservations row) and §5 (booking/availability
 * transaction contract); Data-Model §6 (state machine) and §5 "Actual truth".
 *
 * State machine (Data-Model §6): held -> pending_confirmation -> confirmed -> picked_up ->
 * returned -> completed, with cancelled/expired/rejected as terminal side-exits. Every
 * transition in reservations.service.ts is a single conditional UPDATE guarded by
 * `WHERE id = $1 AND state = $2 AND version = $3` — never a read-then-write.
 */

export const reservationStatusEnum = pgEnum('reservation_status', [
  'held',
  'pending_confirmation',
  'confirmed',
  'picked_up',
  'returned',
  'completed',
  'cancelled',
  'expired',
  'rejected',
]);
export const custodyEventKindEnum = pgEnum('custody_event_kind', ['pickup', 'return']);
export const disruptionStatusEnum = pgEnum('disruption_status', ['open', 'resolved']);

export const customer = pgTable(
  'customer',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    socialMedia: text('social_media'),
    notes: text('notes'),
    privacyNoticeVersion: integer('privacy_notice_version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    ...updatableTimestamps,
  },
  (table) => [
    unique('customer_tenant_id_id_key').on(table.tenantId, table.id),
    index('customer_tenant_name_sort_idx')
      .on(table.tenantId, sql`lower(${table.fullName})`, table.id)
      .where(sql`${table.anonymizedAt} IS NULL`),
    index('customer_tenant_active_name_sort_idx')
      .on(table.tenantId, sql`lower(${table.fullName})`, table.id)
      .where(sql`${table.anonymizedAt} IS NULL AND ${table.archivedAt} IS NULL`),
  ],
);

export const reservation = pgTable(
  'reservation',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id').references(() => customer.id),
    storefrontId: uuid('storefront_id')
      .notNull()
      .references(() => storefront.id),
    policySnapshotId: uuid('policy_snapshot_id')
      .notNull()
      .references(() => policySnapshot.id),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethod.id),
    referenceCode: text('reference_code').notNull(),
    status: reservationStatusEnum('status').notNull().default('held'),
    eventDate: date('event_date', { mode: 'string' }),
    pickupAt: timestamp('pickup_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    timezoneSnapshot: text('timezone_snapshot').notNull(),
    customerSnapshot: jsonb('customer_snapshot').$type<Record<string, unknown>>(),
    deliverySnapshot: jsonb('delivery_snapshot').$type<Record<string, unknown>>(),
    priceSnapshot: jsonb('price_snapshot').$type<Record<string, unknown>>().notNull(),
    currency: text('currency').notNull().default('PHP'),
    rentalTotalMinor: integer('rental_total_minor').notNull(),
    securityRequiredMinor: integer('security_required_minor').notNull().default(0),
    dueNowMinor: integer('due_now_minor').notNull(),
    holdAcquiredAt: timestamp('hold_acquired_at', { withTimezone: true }).notNull().defaultNow(),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Optimistic concurrency token for every conditional state-transition UPDATE.
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique('reservation_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('reservation_tenant_reference_key').on(table.tenantId, table.referenceCode),
    index('reservation_tenant_status_pickup_idx').on(
      table.tenantId,
      table.status,
      table.pickupAt,
      table.id,
    ),
    index('reservation_tenant_pickup_idx').on(table.tenantId, table.pickupAt, table.id),
    index('reservation_tenant_created_idx').on(table.tenantId, table.createdAt, table.id),
    index('reservation_tenant_reference_sort_idx').on(
      table.tenantId,
      sql`lower(${table.referenceCode})`,
      table.id,
    ),
    index('reservation_tenant_due_idx').on(table.tenantId, table.dueAt, table.id),
    index('reservation_tenant_event_date_idx').on(table.tenantId, table.eventDate, table.id),
    index('reservation_tenant_customer_created_idx').on(
      table.tenantId,
      table.customerId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'reservation_branch_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customer.tenantId, customer.id],
      name: 'reservation_customer_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefront.tenantId, storefront.id],
      name: 'reservation_storefront_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.policySnapshotId],
      foreignColumns: [policySnapshot.tenantId, policySnapshot.id],
      name: 'reservation_policy_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.storefrontId, table.policySnapshotId],
      foreignColumns: [policySnapshot.tenantId, policySnapshot.storefrontId, policySnapshot.id],
      name: 'reservation_policy_storefront_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.paymentMethodId],
      foreignColumns: [paymentMethod.tenantId, paymentMethod.id],
      name: 'reservation_payment_method_same_tenant_fk',
    }).onDelete('restrict'),
  ],
);

/** One serialized garment per line — never a quantity. Snapshots freeze offered facts at booking time. */
export const reservationLine = pgTable(
  'reservation_line',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservation.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariant.id),
    lineNumber: integer('line_number').notNull().default(1),
    nameSnapshot: text('name_snapshot').notNull(),
    measurementsSnapshot: jsonb('measurements_snapshot').$type<Record<string, number>>().notNull(),
    pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>().notNull(),
    rentalMinor: integer('rental_minor').notNull(),
    depositMinor: integer('deposit_minor').notNull().default(0),
    currency: text('currency').notNull().default('PHP'),
    ...timestamps,
  },
  (table) => [
    unique('reservation_line_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.reservationId],
      foreignColumns: [reservation.tenantId, reservation.id],
      name: 'reservation_line_reservation_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariant.tenantId, productVariant.id],
      name: 'reservation_line_variant_same_tenant_fk',
    }).onDelete('restrict'),
  ],
);

/** Append-only actual facts, outside the planned-block exclusion — a late return must always be recordable. */
export const custodyEvent = pgTable(
  'custody_event',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => physicalAsset.id),
    reservationLineId: uuid('reservation_line_id').references(() => reservationLine.id),
    actorMembershipId: uuid('actor_membership_id')
      .notNull()
      .references(() => membership.id),
    eventKind: custodyEventKindEnum('event_kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    conditionSnapshot: jsonb('condition_snapshot').$type<Record<string, unknown>>(),
    // Permanent duplicate-safety key: same intent replayed (e.g. double-tap "confirm pickup") is a no-op, not a second event.
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('custody_event_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const disruption = pgTable('disruption', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => physicalAsset.id),
  reservationLineId: uuid('reservation_line_id')
    .notNull()
    .references(() => reservationLine.id),
  causeCustodyEventId: uuid('cause_custody_event_id').references(() => custodyEvent.id),
  reason: text('reason').notNull(),
  status: disruptionStatusEnum('status').notNull().default('open'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
});

/** High-entropy bearer secret; only the hash is stored (TRD §3 guest access). */
export const guestAccessToken = pgTable('guest_access_token', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservation.id),
  tokenHash: text('token_hash').notNull(),
  scopeCodes: jsonb('scope_codes').$type<string[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
});
