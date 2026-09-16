import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

import { db, withTenantTransaction } from '../db/client.js';
import { tenant } from '../db/schema/index.js';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors.js';

export interface TenantContext {
  tenantId: string;
  tenantStatus: 'active' | 'restricted' | 'cancelled';
  membershipId: string;
  role: 'owner' | 'frontdesk';
  /** Allowlisted permission codes from every branch grant this membership holds (V1: one default grant). */
  permissionCodes: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    tenantContext?: TenantContext;
  }
}

/**
 * Resolves a verified Clerk identity (set by `requireStaffAuth`) to a local tenant + active
 * membership, and denies (fails closed) if any step cannot be completed — TRD §3: "Deny
 * missing, suspended, unknown or mismatched context."
 *
 * Two-step lookup, both required because RLS cannot bootstrap itself: `tenant` is a GLOBAL
 * table (no tenant_id, no RLS — see 0008_rls_policies.sql), so looking it up by
 * `clerk_org_id` needs no tenant context yet. Once the tenant id is known, the `membership`
 * lookup runs inside `withTenantTransaction` so it is subject to the same RLS policy every
 * other tenant-owned query in this codebase goes through — there is no special "trusted"
 * code path that reads membership unscoped.
 *
 * This middleware's transaction is scoped to ITS OWN lookup only; it does not hold a
 * connection open for the rest of the request. Each subsequent service/repository call opens
 * its own `withTenantTransaction(tenantId, membershipId, ...)` using the values attached here.
 */
export async function requireTenantContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const clerkPrincipal = req.clerkPrincipal;
    if (!clerkPrincipal || !clerkPrincipal.clerkOrgId) {
      throw new UnauthenticatedError('Staff requests must select an organization.');
    }

    const [tenantRow] = await db
      .select({ id: tenant.id, status: tenant.status })
      .from(tenant)
      .where(eq(tenant.clerkOrgId, clerkPrincipal.clerkOrgId))
      .limit(1);

    if (!tenantRow) {
      // Unknown org: concealment, not a 403 — TRD §4 ("404 for concealed foreign objects")
      // extends to "this org has no matching tenant" just as much as a foreign-tenant row id.
      throw new ForbiddenError('No tenant is associated with this organization.');
    }
    if (tenantRow.status === 'cancelled') {
      throw new ForbiddenError('This tenant is no longer active.');
    }

    const membershipRow = await withTenantTransaction(
      tenantRow.id,
      clerkPrincipal.clerkUserId,
      async (client) => {
        const result = await client.query<{
          id: string;
          role: 'owner' | 'frontdesk';
          status: 'active' | 'suspended' | 'removed';
        }>(
          `SELECT id, role, status FROM membership WHERE tenant_id = $1 AND clerk_user_id = $2 LIMIT 1`,
          [tenantRow.id, clerkPrincipal.clerkUserId],
        );
        return result.rows[0] ?? null;
      },
    );

    if (!membershipRow || membershipRow.status !== 'active') {
      throw new ForbiddenError('No active membership for this tenant.');
    }

    const permissionRows = await withTenantTransaction(tenantRow.id, clerkPrincipal.clerkUserId, async (client) => {
      const result = await client.query<{ permission_codes: string[] }>(
        `SELECT permission_codes FROM branch_membership WHERE tenant_id = $1 AND membership_id = $2`,
        [tenantRow.id, membershipRow.id],
      );
      return result.rows;
    });

    req.tenantContext = {
      tenantId: tenantRow.id,
      tenantStatus: tenantRow.status,
      membershipId: membershipRow.id,
      role: membershipRow.role,
      permissionCodes: [...new Set(permissionRows.flatMap((row) => row.permission_codes ?? []))],
    };
    next();
  } catch (error) {
    next(error);
  }
}
