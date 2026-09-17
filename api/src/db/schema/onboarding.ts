import { bigint, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn, timestamps, updatableTimestamps } from './_shared.js';
import { account } from './account.js';
import { tenant } from './tenancy.js';

/** Global pre-tenant owner setup. Provider organization creation is handled by a later Clerk slice. */
export const organizationOnboarding = pgTable(
  'organization_onboarding',
  {
    ...idColumn,
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    clerkOrgId: text('clerk_org_id').notNull(),
    status: text('status').notNull().default('incomplete'),
    selectedPlanCode: text('selected_plan_code'),
    provisionedTenantId: uuid('provisioned_tenant_id').references(() => tenant.id),
    ...updatableTimestamps,
  },
  (table) => [
    uniqueIndex('organization_onboarding_clerk_org_key').on(table.clerkOrgId),
    index('organization_onboarding_account_status_idx').on(table.accountId, table.status),
  ],
);

/** Immutable operator evidence for a payment-pending onboarding. */
export const onboardingPaymentVerification = pgTable(
  'onboarding_payment_verification',
  {
    ...idColumn,
    organizationOnboardingId: uuid('organization_onboarding_id')
      .notNull()
      .references(() => organizationOnboarding.id),
    operatorSubject: text('operator_subject').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('PHP'),
    paymentReference: text('payment_reference').notNull(),
    status: text('status').notNull().default('verified'),
    businessKey: text('business_key').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('onboarding_payment_verification_business_key').on(table.businessKey)],
);
