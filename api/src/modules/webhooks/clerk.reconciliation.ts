import type { ClerkWebhookEventType } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withSystemGlobalTransaction } from '../../db/client.js';
import { onboardingMarker, type ClerkOnboardingMarker } from './clerk.schemas.js';

const SYSTEM_REPAIR_PRINCIPAL = 'clerk:webhook-repair';

export type OrganizationCreatedRepairResult =
  | { kind: 'repaired'; onboardingId: string }
  | { kind: 'already_present'; onboardingId: string }
  | { kind: 'skipped' };

export type DeferredClerkReconciliationResult =
  OrganizationCreatedRepairResult | { kind: 'deferred' };

interface OrganizationCreatedRepairInput {
  organizationId: string;
  marker: ClerkOnboardingMarker;
  organizationName?: string;
  organizationSlug?: string;
}

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

/** Repair one missing incomplete onboarding, without provisioning any tenant-side records. */
export async function reconcileOrganizationCreatedMarker(
  input: OrganizationCreatedRepairInput,
): Promise<OrganizationCreatedRepairResult> {
  return withSystemGlobalTransaction(SYSTEM_REPAIR_PRINCIPAL, (client) =>
    reconcileOrganizationCreatedMarkerInTransaction(client, input),
  );
}

/** Transaction-aware form for the future worker when inbox status and repair must commit together. */
export async function reconcileOrganizationCreatedMarkerInTransaction(
  client: PoolClient,
  input: OrganizationCreatedRepairInput,
): Promise<OrganizationCreatedRepairResult> {
  const account = await client.query<{ id: string; current_owned_tenant_id: string | null }>(
    `SELECT id, current_owned_tenant_id
     FROM account
     WHERE id = $1
     FOR UPDATE`,
    [input.marker.account_id],
  );
  const accountRow = account.rows[0];
  if (!accountRow || accountRow.current_owned_tenant_id) {
    return { kind: 'skipped' };
  }

  const byOrganization = await client.query<{
    id: string;
    account_id: string;
    status: string;
  }>(
    `SELECT id, account_id, status
     FROM organization_onboarding
     WHERE clerk_org_id = $1
     FOR UPDATE`,
    [input.organizationId],
  );
  const existing = byOrganization.rows[0];
  if (existing) {
    return existing.account_id === accountRow.id && existing.status === 'incomplete'
      ? { kind: 'already_present', onboardingId: existing.id }
      : { kind: 'skipped' };
  }

  const active = await client.query<{ id: string }>(
    `SELECT id
     FROM organization_onboarding
     WHERE account_id = $1
       AND status IN ('incomplete', 'payment_pending')
     FOR UPDATE`,
    [accountRow.id],
  );
  if (active.rows[0]) {
    return { kind: 'skipped' };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO organization_onboarding
       (account_id, clerk_org_id, organization_name, requested_slug, status)
     VALUES ($1, $2, $3, $4, 'incomplete')
     ON CONFLICT (clerk_org_id) DO NOTHING
     RETURNING id`,
    [
      accountRow.id,
      input.organizationId,
      input.organizationName ?? 'Unspecified organization',
      input.organizationSlug ?? null,
    ],
  );
  return inserted.rows[0]
    ? { kind: 'repaired', onboardingId: inserted.rows[0].id }
    : { kind: 'skipped' };
}
