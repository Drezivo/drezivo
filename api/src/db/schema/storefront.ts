import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { file } from './files.js';
import { branch } from './tenancy.js';
import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: published storefront content, immutable policy versions, and payment method display
 * config. Governed by TRD §2 (Storefront row); Data-Model §12 (`storefront`, `policy_snapshot`,
 * `payment_method`).
 *
 * This module is a projection layer: it depends on catalogue for style/variant facts and on
 * availability for open capacity, but it never allows a public read to reveal fields that
 * are not part of the published projection (see storefront.dto.ts for the explicit allowlist).
 */

export const storefrontStatusEnum = pgEnum('storefront_status', ['draft', 'published', 'suspended']);
export const paymentRailEnum = pgEnum('payment_rail', ['cash', 'manual_qr', 'manual_transfer']);

export const storefront = pgTable(
  'storefront',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    slug: text('slug').notNull(),
    status: storefrontStatusEnum('status').notNull().default('draft'),
    branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
    contact: jsonb('contact').$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  // Global uniqueness (not tenant-scoped): storefront paths are looked up by slug alone on
  // the public route, so the slug namespace must be unique across all tenants.
  (table) => [uniqueIndex('storefront_slug_key').on(table.slug)],
);

/** Immutable once referenced by a reservation's `policy_snapshot_id` — never mutate a version in place; publish a new one. */
export const policySnapshot = pgTable(
  'policy_snapshot',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    storefrontId: uuid('storefront_id')
      .notNull()
      .references(() => storefront.id),
    version: integer('version').notNull(),
    rentalRules: jsonb('rental_rules').$type<Record<string, unknown>>().notNull(),
    depositRules: jsonb('deposit_rules').$type<Record<string, unknown>>().notNull(),
    cancellationRules: jsonb('cancellation_rules').$type<Record<string, unknown>>().notNull(),
    deliveryRules: jsonb('delivery_rules').$type<Record<string, unknown>>().notNull(),
    privacyNotice: text('privacy_notice').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('policy_snapshot_storefront_version_key').on(table.storefrontId, table.version)],
);

/** Sensitive destination metadata — owner edits only; a new version replaces already-shown instructions, never an in-place edit. */
export const paymentMethod = pgTable('payment_method', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  rail: paymentRailEnum('rail').notNull(),
  destinationSnapshot: jsonb('destination_snapshot').$type<Record<string, unknown>>().notNull(),
  qrFileId: uuid('qr_file_id').references(() => file.id),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  ...timestamps,
});
