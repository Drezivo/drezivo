import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenant } from './tenancy.js';
import { idColumn, updatableTimestamps } from './_shared.js';

/**
 * Owns: the global pre-tenant `account` record (TBF-010 / Data-Model §4).
 *
 * A verified Clerk person has exactly one account, holding only the minimum lifecycle state:
 * lifetime-trial consumption and the CURRENT owned-tenant link. It is not a Clerk profile
 * mirror — `clerk_user_id` is the only identity field. A person may hold many Front Desk
 * memberships while owning at most one tenant; that invariant is enforced by serializing on
 * this row (conditional updates in modules/accounts/account.repository.ts) plus the reverse
 * UNIQUE on `current_owned_tenant_id` (at most one current owner per tenant; NULLs distinct,
 * so any number of accounts may hold a free slot — see migration 0009).
 *
 * Global table: it has no `tenant_id`, but RLS limits each row to the transaction-local Clerk
 * principal set by `withGlobalTransaction`. It is never reachable through tenant-scoped queries.
 */
export const account = pgTable(
  'account',
  {
    ...idColumn,
    clerkUserId: text('clerk_user_id').notNull(),
    trialConsumedAt: timestamp('trial_consumed_at', { withTimezone: true }),
    currentOwnedTenantId: uuid('current_owned_tenant_id').references(() => tenant.id),
    ...updatableTimestamps,
  },
  (table) => [
    uniqueIndex('account_clerk_user_id_key').on(table.clerkUserId),
    uniqueIndex('account_current_owned_tenant_id_key').on(table.currentOwnedTenantId),
  ],
);
