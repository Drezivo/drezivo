import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { physicalAsset, productVariant } from './catalogue.js';
import { customer } from './reservations.js';
import { branch, tenant } from './tenancy.js';
import { idColumn, timestamps, updatableTimestamps } from './_shared.js';

/**
 * Owns the V1.1 fitting persistence shape approved in the fittings backend decision record.
 * Migration SQL remains authoritative for the range/constraint/RLS details; this module keeps
 * the typed Drizzle table shape available to repositories without inventing frontend resource
 * concepts such as rooms or staff assignments.
 */

const timestampTzRange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

export const fittingSettings = pgTable(
  'fitting_settings',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    enabled: boolean('enabled').notNull(),
    capacity: integer('capacity').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    feeMinor: bigint('fee_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    ...updatableTimestamps,
  },
  (table) => [
    unique('fitting_settings_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('fitting_settings_tenant_branch_key').on(table.tenantId, table.branchId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'fitting_settings_branch_same_tenant_fk',
    }).onDelete('restrict'),
    check('fitting_settings_capacity_bounds', sql`${table.capacity} BETWEEN 1 AND 100`),
    check(
      'fitting_settings_duration_bounds',
      sql`${table.durationMinutes} BETWEEN 30 AND 1440 AND ${table.durationMinutes} % 30 = 0`,
    ),
    check('fitting_settings_fee_nonnegative', sql`${table.feeMinor} >= 0`),
    check('fitting_settings_currency_shape', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('fitting_settings_version_positive', sql`${table.version} > 0`),
  ],
);

export const fittingAppointment = pgTable(
  'fitting_appointment',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    bookingChannel: text('booking_channel').notNull(),
    status: text('status').notNull(),
    period: timestampTzRange('period').notNull(),
    timezoneSnapshot: text('timezone_snapshot').notNull(),
    currency: text('currency').notNull(),
    feeMinor: bigint('fee_minor', { mode: 'bigint' }).notNull(),
    internalNote: text('internal_note'),
    terminalReason: text('terminal_reason'),
    businessKey: text('business_key').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique('fitting_appointment_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('fitting_appointment_tenant_business_key_key').on(
      table.tenantId,
      table.businessKey,
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'fitting_appointment_branch_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customer.tenantId, customer.id],
      name: 'fitting_appointment_customer_same_tenant_fk',
    }).onDelete('restrict'),
    check('fitting_appointment_booking_channel_check', sql`${table.bookingChannel} = 'staff'`),
    check(
      'fitting_appointment_status_check',
      sql`${table.status} IN ('pending', 'confirmed', 'completed', 'rejected', 'cancelled', 'no_show')`,
    ),
    check(
      'fitting_appointment_period_bounded',
      sql`NOT isempty(${table.period}) AND lower_inc(${table.period}) AND NOT upper_inc(${table.period}) AND lower(${table.period}) IS NOT NULL AND upper(${table.period}) IS NOT NULL AND lower(${table.period}) < upper(${table.period})`,
    ),
    check('fitting_appointment_currency_shape', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('fitting_appointment_fee_nonnegative', sql`${table.feeMinor} >= 0`),
    check('fitting_appointment_version_positive', sql`${table.version} > 0`),
    check(
      'fitting_appointment_terminal_reason_state',
      sql`((${table.status} IN ('rejected', 'cancelled') AND ${table.terminalReason} IS NOT NULL AND length(btrim(${table.terminalReason})) BETWEEN 1 AND 500) OR (${table.status} NOT IN ('rejected', 'cancelled') AND ${table.terminalReason} IS NULL))`,
    ),
  ],
);

export const fittingLine = pgTable(
  'fitting_line',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    fittingId: uuid('fitting_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    assetId: uuid('asset_id'),
    garmentGuaranteed: boolean('garment_guaranteed').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('fitting_line_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.fittingId],
      foreignColumns: [fittingAppointment.tenantId, fittingAppointment.id],
      name: 'fitting_line_fitting_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariant.tenantId, productVariant.id],
      name: 'fitting_line_variant_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [physicalAsset.tenantId, physicalAsset.id],
      name: 'fitting_line_asset_same_tenant_fk',
    }).onDelete('restrict'),
    check(
      'fitting_line_guarantee_asset_check',
      sql`(${table.garmentGuaranteed} AND ${table.assetId} IS NOT NULL) OR (NOT ${table.garmentGuaranteed} AND ${table.assetId} IS NULL)`,
    ),
  ],
);

export const fittingCapacitySlot = pgTable(
  'fitting_capacity_slot',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    slotNumber: integer('slot_number').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique('fitting_capacity_slot_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('fitting_capacity_slot_tenant_branch_number_key').on(
      table.tenantId,
      table.branchId,
      table.slotNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'fitting_capacity_slot_branch_same_tenant_fk',
    }).onDelete('restrict'),
    check('fitting_capacity_slot_number_bounds', sql`${table.slotNumber} BETWEEN 1 AND 100`),
  ],
);

export const fittingSlotAllocation = pgTable(
  'fitting_slot_allocation',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    slotId: uuid('slot_id').notNull(),
    fittingId: uuid('fitting_id').notNull(),
    period: timestampTzRange('period').notNull(),
    isBlocking: boolean('is_blocking').notNull().default(true),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('fitting_slot_allocation_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('fitting_slot_allocation_one_blocking_per_fitting')
      .on(table.tenantId, table.fittingId)
      .where(sql`${table.isBlocking}`),
    foreignKey({
      columns: [table.tenantId, table.slotId],
      foreignColumns: [fittingCapacitySlot.tenantId, fittingCapacitySlot.id],
      name: 'fitting_slot_allocation_slot_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.fittingId],
      foreignColumns: [fittingAppointment.tenantId, fittingAppointment.id],
      name: 'fitting_slot_allocation_fitting_same_tenant_fk',
    }).onDelete('restrict'),
    check(
      'fitting_slot_allocation_period_bounded',
      sql`NOT isempty(${table.period}) AND lower_inc(${table.period}) AND NOT upper_inc(${table.period}) AND lower(${table.period}) IS NOT NULL AND upper(${table.period}) IS NOT NULL AND lower(${table.period}) < upper(${table.period})`,
    ),
    check(
      'fitting_slot_allocation_release_state',
      sql`(${table.isBlocking} AND ${table.releasedAt} IS NULL) OR (NOT ${table.isBlocking} AND ${table.releasedAt} IS NOT NULL)`,
    ),
  ],
);

export const fittingHours = pgTable(
  'fitting_hours',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    weekday: integer('weekday').notNull(),
    startsLocal: time('starts_local').notNull(),
    endsLocal: time('ends_local').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('fitting_hours_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'fitting_hours_branch_same_tenant_fk',
    }).onDelete('restrict'),
    check('fitting_hours_weekday_bounds', sql`${table.weekday} BETWEEN 1 AND 7`),
    check('fitting_hours_window_order', sql`${table.startsLocal} < ${table.endsLocal}`),
    check(
      'fitting_hours_minute_precision',
      sql`extract(second FROM ${table.startsLocal}) = 0 AND extract(second FROM ${table.endsLocal}) = 0 AND extract(hour FROM ${table.startsLocal}) BETWEEN 0 AND 23 AND extract(hour FROM ${table.endsLocal}) BETWEEN 0 AND 23`,
    ),
  ],
);

export const fittingClosure = pgTable(
  'fitting_closure',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    period: timestampTzRange('period').notNull(),
    timezoneSnapshot: text('timezone_snapshot').notNull(),
    reason: text('reason').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('fitting_closure_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'fitting_closure_branch_same_tenant_fk',
    }).onDelete('restrict'),
    check(
      'fitting_closure_period_bounded',
      sql`NOT isempty(${table.period}) AND lower_inc(${table.period}) AND NOT upper_inc(${table.period}) AND lower(${table.period}) IS NOT NULL AND upper(${table.period}) IS NOT NULL AND lower(${table.period}) < upper(${table.period})`,
    ),
    check(
      'fitting_closure_timezone_not_blank',
      sql`length(btrim(${table.timezoneSnapshot})) BETWEEN 1 AND 64`,
    ),
    check('fitting_closure_reason_bounded', sql`length(btrim(${table.reason})) BETWEEN 1 AND 240`),
  ],
);
