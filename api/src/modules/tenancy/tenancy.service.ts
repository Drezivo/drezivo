import type { RequestHandler } from 'express';
import type { PermissionCode, WorkspaceList } from '@drezivo/contracts';

import {
  ForbiddenError,
  TenantCancelledError,
  TenantRestrictedError,
} from '../../shared/errors.js';
import { listActorWorkspaces, type ResolvedActorContext } from './tenancy.repository.js';
import { toWorkspaceList } from './tenancy.dto.js';

export async function getWorkspaces(input: {
  principalId: string;
  cursor?: string;
  limit: number;
}): Promise<WorkspaceList> {
  return toWorkspaceList(await listActorWorkspaces(input.principalId, input.cursor, input.limit));
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
