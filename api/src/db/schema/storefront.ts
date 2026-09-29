import {
  boolean,
  foreignKey,
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
 * are not part of the published projection (see storefront.service.ts and the contracts package for the explicit allowlist).
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
  (table) => [
    unique('storefront_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('storefront_slug_key').on(table.slug),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'storefront_branch_same_tenant_fk',
    }).onDelete('restrict'),
  ],
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
  (table) => [
    unique('policy_snapshot_tenant_id_id_key').on(table.tenantId, table.id),
    unique('policy_snapshot_tenant_storefront_id_id_key').on(
      table.tenantId,
      table.storefrontId,
      table.id,
    ),
    uniqueIndex('policy_snapshot_storefront_version_key').on(table.storefrontId, table.version),
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefront.tenantId, storefront.id],
      name: 'policy_snapshot_storefront_same_tenant_fk',
    }).onDelete('restrict'),
  ],
);

/** Sensitive destination metadata — owner edits only; a new version replaces already-shown instructions, never an in-place edit. */
export const paymentMethod = pgTable(
  'payment_method',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    rail: paymentRailEnum('rail').notNull(),
    destinationSnapshot: jsonb('destination_snapshot').$type<Record<string, unknown>>().notNull(),
    qrFileId: uuid('qr_file_id').references(() => file.id),
    active: boolean('active').notNull().default(true),
    storefrontEnabled: boolean('storefront_enabled').notNull().default(false),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [unique('payment_method_tenant_id_id_key').on(table.tenantId, table.id)],
);
