import type { NextFunction, Request, Response } from 'express';

import type { ActorContext, PermissionCode, TenantStatus } from '@drezivo/contracts';

import { resolveActorContext } from '../modules/tenancy/tenancy.repository.js';
import {
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from '../shared/errors.js';

export interface TenantContext {
  tenantId: string;
  tenantStatus: TenantStatus;
  membershipId: string;
  role: 'owner' | 'frontdesk';
  /** Permission codes from the selected branch only. Other branch grants never authorize a request. */
  permissionCodes: PermissionCode[];
  activeBranchId: string;
  actorContext: ActorContext;
  effectiveTenantStatus: TenantStatus;
}

declare module 'express-serve-static-core' {
  interface Request {
    tenantContext?: TenantContext;
    actorContext?: ActorContext;
    branchSelector?: string;
  }
}

/**
 * Resolves a verified Clerk identity (set by `requireStaffAuth`) to a local tenant + active
 * membership, and denies (fails closed) if any step cannot be completed — TRD §3: "Deny
 * missing, suspended, unknown or mismatched context."
 *
 * Resolution is deliberately one transaction: `tenant` is a global root lookup, then the
 * resolver enters tenant scope for membership, branches, grants, subscription, and entitlements.
 * The only cross-tenant read is the narrow `resolve_actor_workspaces` function used by the
 * separate workspace-list endpoint; this middleware never grants a global RLS exception.
 *
 * This middleware's transaction is scoped to its own lookup only; it does not hold a connection
 * open for the rest of the request. Each subsequent service/repository call opens its own
 * `withTenantTransaction(tenantId, principalId, ...)` using the resolved values attached here.
 */
export async function requireTenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clerkPrincipal = req.clerkPrincipal;
    if (!clerkPrincipal?.clerkOrgId) {
      throw new ForbiddenError('An active organization is required.');
    }

    const rawBranchId = req.header('X-Drezivo-Branch-Id')?.trim();
    if (rawBranchId && !isUuid(rawBranchId)) {
      throw new ValidationError('Branch selector is invalid.');
    }
    if (rawBranchId) req.branchSelector = rawBranchId;

    const result = await resolveActorContext({
      principalId: clerkPrincipal.clerkUserId,
      clerkOrgId: clerkPrincipal.clerkOrgId,
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
    });
    if (result.kind === 'not_found') {
      throw new NotFoundError('Workspace could not be found.');
    }
    if (result.kind === 'forbidden') {
      throw new ForbiddenError('You do not have an active membership in this workspace.');
    }
    if (result.kind === 'state_conflict') {
      throw new StateConflictError('Workspace access state is incomplete.');
    }
    const context = result.context;
    const actorContext: ActorContext = {
      tenant: context.tenant,
      membership: context.membership,
      branches: context.branches,
      active_branch_id: context.active_branch_id,
      branch_grants: context.branch_grants,
      subscription: context.subscription,
      entitlements: context.entitlements,
    };
    req.actorContext = actorContext;

    req.tenantContext = {
      tenantId: context.tenant.id,
      tenantStatus: context.effectiveTenantStatus,
      membershipId: context.membership.id,
      role: context.membership.role,
      permissionCodes: context.activePermissionCodes,
      activeBranchId: context.active_branch_id,
      actorContext,
      effectiveTenantStatus: context.effectiveTenantStatus,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
