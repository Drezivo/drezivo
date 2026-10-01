import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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

import type { BranchOperatingHours } from '@drezivo/contracts';

import { idColumn, timestamps, updatableTimestamps } from './_shared.js';

/**
 * Owns: tenant identity, branches, staff membership and branch-scoped permission grants.
 * Governed by TRD §2 (Tenancy/access row), §3 (auth/tenant isolation); Data-Model §4.
 *
 * `tenant` and its children are the root of every RLS policy in 0008_rls_policies.sql — a
 * row here with no matching policy predicate makes every dependent table unreachable, by
 * design (fail closed).
 */

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'restricted', 'cancelled']);
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'frontdesk']);
export const membershipStatusEnum = pgEnum('membership_status', ['active', 'suspended', 'removed']);

/** Global table — not tenant-owned. `clerk_org_id` is the external identity; `id` survives a provider migration. */
export const tenant = pgTable(
  'tenant',
  {
    ...idColumn,
    clerkOrgId: text('clerk_org_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: tenantStatusEnum('status').notNull().default('active'),
    currency: text('currency').notNull().default('PHP'),
    timezone: text('timezone').notNull().default('Asia/Manila'),
    ...updatableTimestamps,
  },
  (table) => [
    uniqueIndex('tenant_clerk_org_id_key').on(table.clerkOrgId),
    uniqueIndex('tenant_slug_key').on(table.slug),
  ],
);

export const branch = pgTable(
  'branch',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),
    code: text('code').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    timezone: text('timezone').notNull(),
    address: jsonb('address').$type<Record<string, unknown>>(),
    operatingHours: jsonb('operating_hours')
      .$type<BranchOperatingHours>()
      .notNull()
      .default(sql`'{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":["sunday"]}'::jsonb`),
    operatingHoursVersion: bigint('operating_hours_version', { mode: 'number' }).notNull().default(1),
    operatingHoursUpdatedAt: timestamp('operating_hours_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: tenantStatusEnum('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    unique('branch_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('branch_tenant_code_key').on(table.tenantId, table.code),
    // Partial "exactly one default branch per tenant" uniqueness is a migration-only
    // constraint (WHERE is_default) — see 0001_tenancy.sql; Drizzle's pgTable index builder
    // cannot express a partial index predicate, so it is not duplicated here.
  ],
);

/** Whole-day active-branch closures such as holidays; Business Hours own recurring weekdays. */
export const branchClosure = pgTable(
  'branch_closure',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    ...updatableTimestamps,
  },
  (table) => [
    unique('branch_closure_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('branch_closure_tenant_branch_date_key').on(
      table.tenantId,
      table.branchId,
      table.localDate,
    ),
    index('branch_closure_tenant_branch_date_idx').on(
      table.tenantId,
      table.branchId,
      table.localDate,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'branch_closure_branch_same_tenant_fk',
    }).onDelete('restrict'),
    check('branch_closure_reason_bounded', sql`length(btrim(${table.reason})) BETWEEN 1 AND 240`),
    check('branch_closure_version_positive', sql`${table.version} > 0`),
  ],
);

export const membership = pgTable(
  'membership',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    clerkUserId: text('clerk_user_id').notNull(),
    clerkMembershipId: text('clerk_membership_id'),
    role: membershipRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    authzVersion: integer('authz_version').notNull().default(1),
    ...updatableTimestamps,
  },
  (table) => [
    uniqueIndex('membership_tenant_clerk_user_key').on(table.tenantId, table.clerkUserId),
    uniqueIndex('membership_tenant_clerk_membership_key').on(
      table.tenantId,
      table.clerkMembershipId,
    ),
  ],
);

/** V1: one default grant per membership. Permission codes are allowlisted at the service layer, never free text from the client. */
export const branchMembership = pgTable(
  'branch_membership',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => membership.id),
    permissionCodes: jsonb('permission_codes').$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [uniqueIndex('branch_membership_branch_membership_key').on(table.branchId, table.membershipId)],
);
