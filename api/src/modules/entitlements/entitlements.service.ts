import { planCode, type PlanCode } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { CapacityConflictError, StateConflictError, ValidationError } from '../../shared/errors.js';
import {
  countActivePhysicalAssets,
  countReservedFrontdeskSeats,
  lockTenantForQuota,
  readActiveV1Plan,
  readTenantPlan,
  type PlanEntitlementRow,
  type PlanRow,
} from './entitlements.repository.js';

export interface TenantEntitlementSnapshot {
  planId: string;
  planCode: PlanCode;
  planVersion: 1;
  monthlyMinor: number;
  currency: 'PHP';
  physicalAssetsMax: number;
  frontdeskSeatsMax: number;
}

export type QuotaResource = 'physical_assets' | 'frontdesk_seats';

export interface QuotaCheckResult {
  resource: QuotaResource;
  current: number;
  requested: number;
  limit: number;
  remaining: number;
}

export interface PlanCapacityCheckResult {
  physicalAssets: QuotaCheckResult;
  frontdeskSeats: QuotaCheckResult;
}

/** Resolve a selected v1 plan without opening a transaction or hiding malformed seed data. */
export async function resolvePlanEntitlements(
  client: PoolClient,
  requestedPlanCode: string,
): Promise<TenantEntitlementSnapshot> {
  const parsedCode = planCode.safeParse(requestedPlanCode);
  if (!parsedCode.success) {
    throw new StateConflictError('The selected plan is unavailable.');
  }

  const resolved = await readActiveV1Plan(client, parsedCode.data);
  if (!resolved) {
    throw new StateConflictError('The selected plan is unavailable.');
  }
  return toSnapshot(resolved.plan, resolved.entitlements);
}

/** Resolve the active v1 plan attached to the tenant's current subscription. */
export async function resolveTenantEntitlements(
  client: PoolClient,
  tenantId: string,
): Promise<TenantEntitlementSnapshot> {
  const resolved = await readTenantPlan(client, tenantId);
  if (!resolved) {
    throw new StateConflictError('Workspace entitlement state is unavailable.');
  }
  return toSnapshot(resolved.plan, resolved.entitlements);
}

/**
 * Guard an active-asset creation or activation. The caller must keep this client transaction
 * open through its write; the tenant row lock serializes competing quota claims.
 */
export async function assertPhysicalAssetCapacity(
  client: PoolClient,
  tenantId: string,
  additional: number,
): Promise<QuotaCheckResult> {
  validateAdditional(additional);
  await lockTenantQuotaScope(client, tenantId);
  const entitlements = await resolveTenantEntitlements(client, tenantId);
  const current = await countActivePhysicalAssets(client, tenantId);
  return ensureCapacity('physical_assets', current, additional, entitlements.physicalAssetsMax);
}

/**
 * Guard a Front Desk membership or invitation reservation. Pending invitations reserve a seat
 * until their database-time expiry, while the Owner remains outside this count.
 */
export async function assertFrontDeskSeatCapacity(
  client: PoolClient,
  tenantId: string,
  additional: number,
  options?: { excludeInvitationId?: string },
): Promise<QuotaCheckResult> {
  validateAdditional(additional);
  await lockTenantQuotaScope(client, tenantId);
  const entitlements = await resolveTenantEntitlements(client, tenantId);
  const current = await countReservedFrontdeskSeats(client, tenantId, options?.excludeInvitationId);
  return ensureCapacity('frontdesk_seats', current, additional, entitlements.frontdeskSeatsMax);
}

/**
 * Compares current usage with a target plan while the caller owns the tenant lock. This is used
 * for trial plan changes; it intentionally performs no write so the billing transaction can
 * decide which subscription/event rows must commit together.
 */
export async function assertPlanCapacity(
  client: PoolClient,
  tenantId: string,
  target: TenantEntitlementSnapshot,
): Promise<PlanCapacityCheckResult> {
  const currentAssets = await countActivePhysicalAssets(client, tenantId);
  const currentFrontdesk = await countReservedFrontdeskSeats(client, tenantId);
  return {
    physicalAssets: ensureCapacity('physical_assets', currentAssets, 0, target.physicalAssetsMax),
    frontdeskSeats: ensureCapacity('frontdesk_seats', currentFrontdesk, 0, target.frontdeskSeatsMax),
  };
}

export async function lockTenantQuotaScope(client: PoolClient, tenantId: string): Promise<void> {
  if (!(await lockTenantForQuota(client, tenantId))) {
    throw new StateConflictError('Workspace entitlement state is unavailable.');
  }
}

function ensureCapacity(
  resource: QuotaResource,
  current: number,
  requested: number,
  limit: number,
): QuotaCheckResult {
  if (current + requested > limit) {
    throw new CapacityConflictError('The workspace plan limit would be exceeded.');
  }
  return {
    resource,
    current,
    requested,
    limit,
    remaining: limit - current - requested,
  };
}

function validateAdditional(additional: number): void {
  if (!Number.isSafeInteger(additional) || additional <= 0) {
    throw new ValidationError('The requested quota increase must be a positive integer.');
  }
}

function toSnapshot(plan: PlanRow, entitlements: PlanEntitlementRow[]): TenantEntitlementSnapshot {
  if (
    plan.version !== 1 ||
    !plan.active ||
    plan.currency !== 'PHP' ||
    !Number.isSafeInteger(plan.monthly_minor) ||
    plan.monthly_minor <= 0
  ) {
    throw new StateConflictError('Workspace entitlement state is unavailable.');
  }

  const parsedCode = planCode.safeParse(plan.code);
  if (!parsedCode.success) {
    throw new StateConflictError('Workspace entitlement state is unavailable.');
  }

  const values = new Map(entitlements.map((row) => [row.capability, row]));
  const assets = requireNumericEntitlement(values.get('physical_assets.max'));
  const seats = requireNumericEntitlement(values.get('frontdesk_seats.max'));

  return {
    planId: plan.id,
    planCode: parsedCode.data,
    planVersion: 1,
    monthlyMinor: plan.monthly_minor,
    currency: 'PHP',
    physicalAssetsMax: assets,
    frontdeskSeatsMax: seats,
  };
}

function requireNumericEntitlement(row: PlanEntitlementRow | undefined): number {
  if (!row?.enabled || row.limit_value === null || !Number.isSafeInteger(row.limit_value) || row.limit_value <= 0) {
    throw new StateConflictError('Workspace entitlement state is unavailable.');
  }
  return row.limit_value;
}
