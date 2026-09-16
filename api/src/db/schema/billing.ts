import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: Drezivo's OWN SaaS subscription/entitlement records for a tenant. Governed by
 * TRD §2 (Platform billing row) and §6 (operational finance / subscription lifecycle);
 * Data-Model §8.
 *
 * `subscription_payment` records Drezivo's revenue collection from the tenant ONLY — it must
 * never be joined against, or share a balance with, the renter-facing `payment`/`charge`
 * tables in finance.ts. Confusing the two ledgers is the single most damaging mistake this
 * module could make.
 */

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'restricted',
  'cancelled',
]);
export const subscriptionEventTypeEnum = pgEnum('subscription_event_type', [
  'trial_started',
  'converted',
  'renewed',
  'plan_changed',
  'past_due',
  'restricted',
  'cancelled',
]);
export const subscriptionPaymentStatusEnum = pgEnum('subscription_payment_status', ['pending', 'verified', 'failed']);

/** Immutable price versions — owner-confirmed PHP minor units per TRD §6: Starter 30000, Professional 49900, Business 129900. */
export const plan = pgTable(
  'plan',
  {
    ...idColumn,
    code: text('code').notNull(),
    version: integer('version').notNull(),
    monthlyMinor: integer('monthly_minor').notNull(),
    currency: text('currency').notNull().default('PHP'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex('plan_code_version_key').on(table.code, table.version)],
);

/** A null `limitValue` means "not a numeric capability", never "unlimited" — both entitlement AND release-flag must pass. */
export const planEntitlement = pgTable('plan_entitlement', {
  ...idColumn,
  planId: uuid('plan_id')
    .notNull()
    .references(() => plan.id),
  capability: text('capability').notNull(),
  limitValue: integer('limit_value'),
  enabled: boolean('enabled').notNull().default(true),
});

/** One current subscription per tenant (enforced by a unique index on tenant_id in the migration, not here). */
export const subscription = pgTable('subscription', {
  ...idColumn,
  tenantId: uuid('tenant_id').notNull(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plan.id),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  providerReference: text('provider_reference'),
  ...timestamps,
});

export const subscriptionEvent = pgTable(
  'subscription_event',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    priorPlanId: uuid('prior_plan_id').references(() => plan.id),
    nextPlanId: uuid('next_plan_id')
      .notNull()
      .references(() => plan.id),
    eventType: subscriptionEventTypeEnum('event_type').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    businessKey: text('business_key').notNull(),
  },
  (table) => [uniqueIndex('subscription_event_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);

export const subscriptionPayment = pgTable(
  'subscription_payment',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('PHP'),
    status: subscriptionPaymentStatusEnum('status').notNull().default('pending'),
    collectionMethod: text('collection_method').notNull(),
    providerReference: text('provider_reference'),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('subscription_payment_tenant_business_key_key').on(table.tenantId, table.businessKey)],
);
