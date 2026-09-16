import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { physicalAsset } from './catalogue.js';
import { branch } from './tenancy.js';
import { idColumn } from './_shared.js';

/**
 * Owns: the ONE authoritative planned-unavailability table for physical assets. Governed by
 * TRD §2 (Availability row) and §5 (booking/availability transaction contract);
 * Data-Model §5 "Canonical planned block".
 *
 * This module must never let a caller "check availability then insert" as two steps — the
 * GiST exclusion constraint added in 0003_availability_exclusion.sql is the only thing that
 * makes a capacity claim correct under concurrency, and Drizzle's schema DSL cannot express
 * that constraint (no partial-predicate EXCLUDE support), so it is hand-written in SQL and
 * this file is kept in sync with it by review, not by `db:generate`.
 *
 * `period` is a Postgres `tstzrange`; Drizzle has no first-class range column builder, so it
 * is declared with `customType` at the point of use (see availability.repository.ts /
 * reservations.repository.ts) rather than mistyped here as `text`.
 */

export const allocationKindEnum = pgEnum('asset_allocation_kind', [
  'reservation_hold',
  'reservation_confirmed',
  'maintenance',
  'fitting',
  'transfer',
]);
export const workOrderKindEnum = pgEnum('maintenance_work_order_kind', ['cleaning', 'repair', 'manual_block']);
export const workOrderStatusEnum = pgEnum('maintenance_work_order_status', ['open', 'closed']);

export const maintenanceWorkOrder = pgTable('maintenance_work_order', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branch.id),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => physicalAsset.id),
  kind: workOrderKindEnum('kind').notNull(),
  status: workOrderStatusEnum('status').notNull().default('open'),
  reason: text('reason').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

/**
 * `asset_allocation` itself is declared in the migration (0003) alongside its EXCLUDE
 * constraint and `tstzrange` column, not duplicated here as a parallel Drizzle table — a
 * second definition of the same table in two systems of record is exactly the drift AGENTS.md
 * warns against ("do not create duplicate manual types that can drift"). Read access from
 * repositories uses `sql` template queries against this table; see
 * availability.repository.ts / reservations.repository.ts for the read/write shape actually
 * used, and 0003_availability_exclusion.sql for the authoritative column list.
 */
export const ASSET_ALLOCATION_TABLE = 'asset_allocation';

export type AssetAllocationKind = (typeof allocationKindEnum.enumValues)[number];

export const BLOCKING_RESERVATION_KINDS: readonly AssetAllocationKind[] = [
  'reservation_hold',
  'reservation_confirmed',
];
