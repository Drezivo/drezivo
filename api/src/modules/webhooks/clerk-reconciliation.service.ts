import type { ClerkWebhookEventType } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withSystemGlobalTransaction } from '../../db/client.js';
import { onboardingMarker } from './clerk.schemas.js';
import {
  reconcileOrganizationCreatedMarkerInTransaction as persistOrganizationCreatedMarkerInTransaction,
  type OrganizationCreatedRepairInput,
  type OrganizationCreatedRepairResult,
} from './clerk-reconciliation.repository.js';

const SYSTEM_REPAIR_PRINCIPAL = 'clerk:webhook-repair';

export type DeferredClerkReconciliationResult =
  OrganizationCreatedRepairResult | { kind: 'deferred' };

/**
 * TBF-022's deferred consumer contract. The HTTP route never calls this function: it only
 * inserts a verified inbox row. TBF-060 can call it from a worker transaction after claiming a
 * row. Organization-created is the one repairable event in this slice; all other accepted
 * families remain retained for later reconciliation.
 */
export async function reconcileDeferredClerkEvent(input: {
  eventType: ClerkWebhookEventType;
  safePayload: Record<string, unknown>;
}): Promise<DeferredClerkReconciliationResult> {
  if (input.eventType !== 'organization.created') {
    return { kind: 'deferred' };
  }

  const organizationId = input.safePayload.organization_id;
  const marker = onboardingMarker.safeParse(input.safePayload.drezivo_onboarding);
  if (typeof organizationId !== 'string' || !marker.success) {
    return { kind: 'skipped' };
  }

  const repairInput: OrganizationCreatedRepairInput = { organizationId, marker: marker.data };
  if (typeof input.safePayload.organization_name === 'string')
    repairInput.organizationName = input.safePayload.organization_name;
  if (typeof input.safePayload.organization_slug === 'string')
    repairInput.organizationSlug = input.safePayload.organization_slug;
  return reconcileOrganizationCreatedMarker(repairInput);
}

/** Repair one missing incomplete onboarding, without provisioning tenant-side records. */
export async function reconcileOrganizationCreatedMarker(
  input: OrganizationCreatedRepairInput,
): Promise<OrganizationCreatedRepairResult> {
  return withSystemGlobalTransaction(SYSTEM_REPAIR_PRINCIPAL, (client) =>
    persistOrganizationCreatedMarkerInTransaction(client, input),
  );
}

/** Compatibility entry point for the worker when inbox status and repair share one transaction. */
export async function reconcileOrganizationCreatedMarkerInTransaction(
  client: PoolClient,
  input: OrganizationCreatedRepairInput,
): Promise<OrganizationCreatedRepairResult> {
  return persistOrganizationCreatedMarkerInTransaction(client, input);
}
