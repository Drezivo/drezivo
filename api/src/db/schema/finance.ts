import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { file } from './files.js';
import { reservation } from './reservations.js';
import { paymentMethod } from './storefront.js';
import { membership } from './tenancy.js';
import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: verified collections, append-only charge/allocation/deposit postings, and refund
 * workflow state. Governed by TRD §2 (Finance row) and §6 (operational finance);
 * Data-Model §7 "Operational financial subledger".
 *
 * This is a subledger, not a general ledger — Data-Model §7 balance formula:
 *   U = P − A − H − R   (unassigned = verified payment − charge allocations − deposit
 *   holding − refund instructions), and A, H, R, U must all stay nonnegative.
 * `charge`, `payment_allocation`, and `deposit_entry` are APPEND-ONLY: corrections are new
 * reversal rows linked via `reversesId`, never an UPDATE/DELETE on a posted row. The runtime
 * DB role enforces this (see 0008_rls_policies.sql) — it is not merely an application
 * convention this module happens to follow.
 */

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'partially_paid',
  'paid',
  'failed',
  'refunded',
]);
export const evidenceStatusEnum = pgEnum('payment_evidence_status', [
  'uploaded',
  'under_review',
  'verified',
  'rejected',
  'superseded',
]);
export const verificationDecisionEnum = pgEnum('payment_verification_decision', [
  'verified',
  'rejected',
  'ask_info',
]);
export const chargeKindEnum = pgEnum('charge_kind', ['rental', 'delivery', 'late_fee', 'damage_fee', 'credit']);
export const allocationDirectionEnum = pgEnum('payment_allocation_direction', ['apply', 'reverse']);
export const refundStatusEnum = pgEnum('refund_status', [
  'requested',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);
export const refundPurposeEnum = pgEnum('refund_purpose', ['rental', 'security_deposit']);
export const depositEntryKindEnum = pgEnum('deposit_entry_kind', ['receive', 'apply', 'release', 'reverse']);

/** Pending intent is guarded-mutable; once `verifiedAt` is set, amount/currency/reference are immutable — corrections are reversals elsewhere, never an edit here. */
export const payment = pgTable('payment', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  reservationId: uuid('reservation_id').references(() => reservation.id),
  paymentMethodId: uuid('payment_method_id')
    .notNull()
    .references(() => paymentMethod.id),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('PHP'),
  status: paymentStatusEnum('status').notNull().default('pending'),
  merchantReference: text('merchant_reference'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  businessKey: text('business_key').notNull(),
}, (table) => [uniqueIndex('payment_tenant_business_key_key').on(table.tenantId, table.businessKey)]);

export const paymentReceipt = pgTable('payment_receipt', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payment.id),
  fileId: uuid('file_id')
    .notNull()
    .references(() => file.id),
  evidenceStatus: evidenceStatusEnum('evidence_status').notNull().default('uploaded'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable review decision. At most one successful settlement per payment, enforced by a locked conditional transition — never a second UPDATE winning silently. */
export const paymentVerification = pgTable(
  'payment_verification',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.id),
    verifierMembershipId: uuid('verifier_membership_id')
      .notNull()
      .references(() => membership.id),
    decision: verificationDecisionEnum('decision').notNull(),
    verifiedAmountMinor: integer('verified_amount_minor'),
    cashTenderedMinor: integer('cash_tendered_minor'),
    changeDueMinor: integer('change_due_minor'),
    evidenceNote: text('evidence_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    businessKey: text('business_key').notNull(),
  },
  (table) => [uniqueIndex('payment_verification_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const charge = pgTable(
  'charge',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    reservationId: uuid('reservation_id').references(() => reservation.id),
    kind: chargeKindEnum('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('PHP'),
    reversesId: uuid('reverses_id'),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('charge_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const paymentAllocation = pgTable(
  'payment_allocation',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.id),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charge.id),
    amountMinor: integer('amount_minor').notNull(),
    direction: allocationDirectionEnum('direction').notNull(),
    reversesId: uuid('reverses_id'),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('payment_allocation_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const refund = pgTable(
  'refund',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('PHP'),
    purpose: refundPurposeEnum('purpose').notNull(),
    status: refundStatusEnum('status').notNull().default('requested'),
    merchantReference: text('merchant_reference'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => membership.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('refund_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const depositEntry = pgTable(
  'deposit_entry',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservation.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.id),
    chargeId: uuid('charge_id').references(() => charge.id),
    refundId: uuid('refund_id').references(() => refund.id),
    kind: depositEntryKindEnum('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('PHP'),
    reversesId: uuid('reverses_id'),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('deposit_entry_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);
