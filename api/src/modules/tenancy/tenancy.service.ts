import type { RequestHandler } from 'express';
import type { PermissionCode, WorkspaceList } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import {
  ForbiddenError,
  TenantCancelledError,
  TenantRestrictedError,
  StateConflictError,
} from '../../shared/errors.js';
import {
  hasActiveTenantOwnerMembership,
  listActorWorkspaces,
  type ResolvedActorContext,
} from './tenancy.repository.js';
import { toWorkspaceList } from './tenancy.dto.js';
import type { PlanFeatureKey } from '../entitlements/entitlements.service.js';

export async function getWorkspaces(input: {
  principalId: string;
  cursor?: string;
  limit: number;
}): Promise<WorkspaceList> {
  return toWorkspaceList(await listActorWorkspaces(input.principalId, input.cursor, input.limit));
}

export async function assertTenantOwnerMembership(
  client: PoolClient,
  input: { tenantId: string; membershipId: string; principalId: string },
): Promise<void> {
  if (!(await hasActiveTenantOwnerMembership(client, input))) {
    throw new ForbiddenError('Only the active tenant owner can manage workspace members.');
  }
}

export type TenantAction =
  | 'context_read'
  | 'existing_rental_read'
  | 'settlement'
  | 'return'
  | 'refund'
  | 'export'
  | 'new_booking'
  | 'publish'
  | 'asset_write'
  | 'invitation';

const restrictedAllowedActions = new Set<TenantAction>([
  'context_read',
  'existing_rental_read',
  'settlement',
  'return',
  'refund',
  'export',
]);
const cancelledAllowedActions = new Set<TenantAction>(['context_read', 'settlement', 'export']);

/** Shared lifecycle gate. Routes may call this before a controller, and services must re-check it. */
export function assertTenantAction(context: ResolvedActorContext, action: TenantAction): void {
  if (isTenantActionAllowed(context.effectiveTenantStatus, action)) return;
  throwTenantLifecycleError(context.effectiveTenantStatus);
}

export function assertBranchPermission(
  context: ResolvedActorContext,
  permission: PermissionCode,
): void {
  if (!context.activePermissionCodes.includes(permission)) {
    throw new ForbiddenError('This branch does not grant the requested capability.');
  }
}

/** Route helper for the lifecycle policy. Services must call the same assertion before writes. */
export function requireTenantAction(action: TenantAction): RequestHandler {
  return (req, _res, next): void => {
    try {
      const context = req.tenantContext;
      if (!context) throw new ForbiddenError('Tenant context is required.');
      if (isTenantActionAllowed(context.effectiveTenantStatus, action)) {
        next();
        return;
      }
      throwTenantLifecycleError(context.effectiveTenantStatus);
    } catch (error) {
      next(error);
    }
  };
}

/** Shared server-side feature check for tenant routes; UI visibility is never authorization. */
export function requirePlanFeature(feature: PlanFeatureKey): RequestHandler {
  return (req, _res, next): void => {
    const features = req.tenantContext?.actorContext.entitlements.features;
    if (!features) {
      next(new StateConflictError('Workspace entitlement state is unavailable.'));
      return;
    }
    if (!features[feature]) {
      next(new StateConflictError('Upgrade your plan to unlock this feature.'));
      return;
    }
    next();
  };
}

function isTenantActionAllowed(
  status: ResolvedActorContext['effectiveTenantStatus'],
  action: TenantAction,
): boolean {
  if (status === 'active') return true;
  return status === 'restricted'
    ? restrictedAllowedActions.has(action)
    : cancelledAllowedActions.has(action);
}

function throwTenantLifecycleError(status: ResolvedActorContext['effectiveTenantStatus']): never {
  if (status === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  throw new TenantCancelledError('This workspace is closed.');
}
