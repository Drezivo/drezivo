/**
 * TRD §3 — staff auth: "Map verified organization identity to the unique
 * local tenant; resolve the local active membership and server-defined
 * capability. Deny missing, suspended, unknown or mismatched context."
 * Data-Model §2 entity dictionary — `tenant`, `branch`, `membership`,
 * `branch_membership`.
 *
 * `clerk_org_id` / `clerk_user_id` are internal identity-mapping keys
 * (Data-Model §4: "The internal UUID survives a provider migration") — they
 * are not part of this wire contract. `app` correlates a membership to a
 * Clerk profile through its own Clerk session, not through this API.
 */
import { z } from 'zod';

import { branchId, membershipId, tenantId } from '../common/ids';
import { currencyCode } from '../common/money';
import { isoInstant } from '../common/time';

/** Data-Model §2 `tenant.status`: "current state is not historical booking policy." */
export const tenantStatus = z.enum(['active', 'restricted', 'cancelled']);
export type TenantStatus = z.infer<typeof tenantStatus>;

export const tenant = z.object({
  id: tenantId,
  name: z.string().min(1),
  slug: z.string().min(1),
  status: tenantStatus,
  currency: currencyCode,
  timezone: z.string().min(1),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type Tenant = z.infer<typeof tenant>;

/**
 * PRD §2: "Owner controls policies, payment instructions, money
 * verification, users, and inventory. Front desk serves customers, updates
 * operations, and records custody." V1 has exactly these two roles.
 */
export const membershipRole = z.enum(['owner', 'frontdesk']);
export type MembershipRole = z.infer<typeof membershipRole>;

/**
 * TRD §3: "Access removal initiated in Drezivo first disables local
 * membership, then queues the Clerk change." A removed membership is kept
 * (not deleted) so historical custody/audit rows still resolve their actor.
 */
export const membershipStatus = z.enum(['active', 'removed']);
export type MembershipStatus = z.infer<typeof membershipStatus>;

export const membership = z.object({
  id: membershipId,
  role: membershipRole,
  status: membershipStatus,
  updated_at: isoInstant,
});
export type Membership = z.infer<typeof membership>;

/**
 * PRD §5 capability table, translated into an allowlisted vocabulary
 * (Data-Model §2 `branch_membership.permission_codes`: "JSON codes are
 * allowlisted"). Fail-closed: an unrecognized code is a validation error,
 * not a code the UI silently ignores. Extending this list is additive-only
 * (expand, never repurpose a code's meaning) per the contract's breaking-
 * change discipline in the README.
 */
export const permissionCode = z.enum([
  'assets.manage',
  'assets.archive',
  'reservations.manage',
  'reservations.custody',
  'payments.manage',
  'payments.view',
  'evidence.verify',
  'evidence.view',
  'documents.identity.view',
  'documents.receipt.view',
  'policies.manage',
  'users.manage',
  'exports.request',
  'exports.manage',
  'deletion.manage',
]);
export type PermissionCode = z.infer<typeof permissionCode>;

/** Data-Model §2 `branch.status`; V1 ships one default branch, always active. */
export const branchStatus = z.enum(['active', 'archived']);
export type BranchStatus = z.infer<typeof branchStatus>;

export const branch = z.object({
  id: branchId,
  name: z.string().min(1),
  code: z.string().min(1),
  is_default: z.boolean(),
  timezone: z.string().min(1),
  status: branchStatus,
});
export type Branch = z.infer<typeof branch>;

/** One membership's capability grant on one branch (Data-Model `branch_membership`). */
export const branchGrant = z.object({
  branch_id: branchId,
  permission_codes: z.array(permissionCode),
});
export type BranchGrant = z.infer<typeof branchGrant>;
