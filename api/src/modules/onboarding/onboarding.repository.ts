import type { OnboardingStatus, PlanCode } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withGlobalTransaction, withOperatorGlobalTransaction } from '../../db/client.js';
import { enqueueClerkOrganizationCleanup } from './onboarding-cleanup.repository.js';

/**
 * TBF-011 — global owner onboarding persistence.
 *
 * This module deliberately stops at the pre-tenant boundary. It does not call Clerk, create a
 * tenant, start a trial, or expose an HTTP command. Every mutation serializes on the account
 * row first, then applies a conditional onboarding transition. The result unions are intended
 * for the later HTTP layer to map to contract errors without leaking unrelated provider
 * identifiers; the authenticated owner projection may include its own opaque Clerk org ID.
 */

export interface OwnerOnboardingRecord {
  id: string;
  clerkOrgId: string;
  organizationName: string;
  requestedSlug: string | null;
  status: OnboardingStatus;
  selectedPlanCode: PlanCode | null;
  isTrialEligible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerPaymentStatus {
  id: string;
  status: 'verified';
  createdAt: Date;
}

export interface OperatorPaymentRecord extends OwnerPaymentStatus {
  onboardingId: string;
  operatorSubject: string;
  amountMinor: string;
  currency: 'PHP';
  paymentReference: string;
  businessKey: string;
}

export type CreateOrResumeOnboardingResult =
  | { kind: 'created'; onboarding: OwnerOnboardingRecord }
  | { kind: 'existing'; onboarding: OwnerOnboardingRecord }
  | { kind: 'active_exists'; onboarding: OwnerOnboardingRecord }
  | { kind: 'owned_tenant' }
  | { kind: 'organization_conflict' }
  | { kind: 'not_found_or_forbidden' };

export type AbandonOnboardingResult =
  | { kind: 'abandoned'; onboarding: OwnerOnboardingRecord }
  | { kind: 'already_abandoned'; onboarding: OwnerOnboardingRecord }
  | { kind: 'provisioned'; onboarding: OwnerOnboardingRecord }
  | { kind: 'not_found_or_forbidden' };

export type ChooseOnboardingPlanResult =
  | { kind: 'updated'; onboarding: OwnerOnboardingRecord }
  | { kind: 'owned_tenant' }
  | { kind: 'not_selectable'; onboarding: OwnerOnboardingRecord }
  | { kind: 'plan_unavailable' }
  | { kind: 'not_found_or_forbidden' };

export type RecordOnboardingPaymentResult =
  | { kind: 'recorded'; payment: OperatorPaymentRecord }
  | { kind: 'replayed'; payment: OperatorPaymentRecord }
  | { kind: 'business_key_conflict' }
  | { kind: 'onboarding_not_payment_pending' }
  | { kind: 'not_found_or_forbidden' };

interface AccountLifecycleRow {
  id: string;
  trial_consumed_at: Date | null;
  current_owned_tenant_id: string | null;
}

interface OnboardingRow {
  id: string;
  account_id: string;
  clerk_org_id: string;
  organization_name: string;
  requested_slug: string | null;
  status: string;
  selected_plan_code: string | null;
  provisioned_tenant_id: string | null;
  trial_consumed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PaymentRow {
  id: string;
  organization_onboarding_id: string;
  operator_subject: string;
  amount_minor: string;
  currency: string;
  payment_reference: string;
  status: string;
  business_key: string;
  created_at: Date;
}

/** Create a new unfinished onboarding, or safely resume an existing Clerk organization. */
export async function createOrResumeOnboarding(
  accountId: string,
  clerkOrgId: string,
  principalId: string,
  details: { organizationName?: string; requestedSlug?: string | null } = {},
): Promise<CreateOrResumeOnboardingResult> {
  return withGlobalTransaction(principalId, (client) =>
    createOrResumeOnboardingInTransaction(client, accountId, clerkOrgId, principalId, details),
  );
}

/** Transaction-aware form used when the onboarding row and bootstrap ledger must commit together. */
export async function createOrResumeOnboardingInTransaction(
  client: PoolClient,
  accountId: string,
  clerkOrgId: string,
  principalId: string,
  details: { organizationName?: string; requestedSlug?: string | null } = {},
): Promise<CreateOrResumeOnboardingResult> {
  const account = await lockAccount(client, accountId, principalId);
  if (!account) {
    return { kind: 'not_found_or_forbidden' };
  }
  if (account.current_owned_tenant_id) {
    return { kind: 'owned_tenant' };
  }

  // Check the provider correlation before the active-row check: retrying the same Clerk
  // organization is idempotent even when its onboarding is already active.
  const sameOrganization = await client.query<OnboardingRow>(
    `${onboardingSelect}
       FROM organization_onboarding o
       JOIN account a ON a.id = o.account_id
       WHERE o.clerk_org_id = $1
       FOR UPDATE OF o`,
    [clerkOrgId],
  );
  if (sameOrganization.rows[0]) {
    const row = sameOrganization.rows[0];
    if (row.account_id !== account.id) {
      return { kind: 'organization_conflict' };
    }
    if (row.status === 'incomplete' || row.status === 'payment_pending') {
      return { kind: 'existing', onboarding: toOwnerOnboarding(row) };
    }
    return { kind: 'organization_conflict' };
  }

  const active = await client.query<OnboardingRow>(
    `${onboardingSelect}
       FROM organization_onboarding o
       JOIN account a ON a.id = o.account_id
       WHERE o.account_id = $1
         AND o.status IN ('incomplete', 'payment_pending')
       FOR UPDATE OF o`,
    [account.id],
  );
  if (active.rows[0]) {
    return { kind: 'active_exists', onboarding: toOwnerOnboarding(active.rows[0]) };
  }

  const inserted = await client.query<OnboardingRow>(
    `INSERT INTO organization_onboarding (account_id, clerk_org_id, organization_name, requested_slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_org_id) DO NOTHING
       RETURNING id, account_id, clerk_org_id, organization_name, requested_slug, status, selected_plan_code,
                 provisioned_tenant_id, created_at, updated_at`,
    [
      account.id,
      clerkOrgId,
      details.organizationName ?? 'Unspecified organization',
      details.requestedSlug ?? null,
    ],
  );
  if (inserted.rows[0]) {
    return {
      kind: 'created',
      onboarding: toOwnerOnboarding({
        ...inserted.rows[0],
        trial_consumed_at: account.trial_consumed_at,
      }),
    };
  }

  // A conflicting provider organization can be hidden by the owner RLS policy. Do not
  // fabricate an onboarding or expose whether another account owns it.
  return { kind: 'organization_conflict' };
}

/** Return the current owner-safe onboarding projection, if one exists. */
export async function getCurrentOwnerOnboarding(
  principalId: string,
): Promise<OwnerOnboardingRecord | null> {
  return withGlobalTransaction(principalId, async (client) => {
    const result = await client.query<OnboardingRow>(
      `${onboardingSelect}
       FROM organization_onboarding o
       JOIN account a ON a.id = o.account_id
       WHERE a.clerk_user_id = $1
         AND o.status IN ('incomplete', 'payment_pending')
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [principalId],
    );
    return result.rows[0] ? toOwnerOnboarding(result.rows[0]) : null;
  });
}

/** Read one owner-safe onboarding projection, including the opaque Clerk organization ID. */
export async function getOwnerOnboarding(
  onboardingId: string,
  principalId: string,
): Promise<OwnerOnboardingRecord | null> {
  return withGlobalTransaction(principalId, async (client) => {
    const result = await client.query<OnboardingRow>(
      `${onboardingSelect}
       FROM organization_onboarding o
       JOIN account a ON a.id = o.account_id
       WHERE o.id = $1 AND a.clerk_user_id = $2`,
      [onboardingId, principalId],
    );
    return result.rows[0] ? toOwnerOnboarding(result.rows[0]) : null;
  });
}

/** Abandon an unfinished onboarding while retaining its Clerk correlation and history. */
export async function abandonOnboarding(
  onboardingId: string,
  principalId: string,
): Promise<AbandonOnboardingResult> {
  return withGlobalTransaction(principalId, async (client) =>
    abandonOnboardingInTransaction(client, onboardingId, principalId),
  );
}

export async function abandonOnboardingInTransaction(
  client: PoolClient,
  onboardingId: string,
  principalId: string,
): Promise<AbandonOnboardingResult> {
  const accountId = await findOwnerAccountId(client, onboardingId, principalId);
  if (!accountId) {
    return { kind: 'not_found_or_forbidden' };
  }
  const account = await lockAccount(client, accountId, principalId);
  if (!account) {
    return { kind: 'not_found_or_forbidden' };
  }
  const row = await lockOwnerOnboarding(client, onboardingId, principalId);
  if (!row) {
    return { kind: 'not_found_or_forbidden' };
  }
  if (row.status === 'abandoned') {
    await enqueueClerkOrganizationCleanup(client, {
      onboardingId: row.id,
      accountId,
      clerkOrgId: row.clerk_org_id,
    });
    return { kind: 'already_abandoned', onboarding: toOwnerOnboarding(row) };
  }
  if (row.status === 'provisioned') {
    return { kind: 'provisioned', onboarding: toOwnerOnboarding(row) };
  }

  const updated = await client.query<OnboardingRow>(
    `UPDATE organization_onboarding
       SET status = 'abandoned', updated_at = now()
       WHERE id = $1 AND status IN ('incomplete', 'payment_pending')
       RETURNING id, account_id, clerk_org_id, organization_name, requested_slug, status, selected_plan_code,
                 provisioned_tenant_id, created_at, updated_at`,
    [onboardingId],
  );
  const updatedRow = updated.rows[0];
  if (!updatedRow) {
    const current = await lockOwnerOnboarding(client, onboardingId, principalId);
    return current?.status === 'abandoned'
      ? { kind: 'already_abandoned', onboarding: toOwnerOnboarding(current) }
      : current
        ? { kind: 'provisioned', onboarding: toOwnerOnboarding(current) }
        : { kind: 'not_found_or_forbidden' };
  }
  await enqueueClerkOrganizationCleanup(client, {
    onboardingId: updatedRow.id,
    accountId,
    clerkOrgId: updatedRow.clerk_org_id,
  });
  return {
    kind: 'abandoned',
    onboarding: toOwnerOnboarding({ ...updatedRow, trial_consumed_at: account.trial_consumed_at }),
  };
}

/** Choose a plan, moving lifetime-trial-consumed accounts to payment_pending. */
export async function chooseOnboardingPlan(
  onboardingId: string,
  planCode: PlanCode,
  principalId: string,
): Promise<ChooseOnboardingPlanResult> {
  return withGlobalTransaction(principalId, (client) =>
    chooseOnboardingPlanInTransaction(client, onboardingId, planCode, principalId),
  );
}

/** Transaction-aware plan selection used by the idempotent HTTP command. */
export async function chooseOnboardingPlanInTransaction(
  client: PoolClient,
  onboardingId: string,
  planCode: PlanCode,
  principalId: string,
): Promise<ChooseOnboardingPlanResult> {
  const accountId = await findOwnerAccountId(client, onboardingId, principalId);
  if (!accountId) {
    return { kind: 'not_found_or_forbidden' };
  }
  const account = await lockAccount(client, accountId, principalId);
  if (!account) {
    return { kind: 'not_found_or_forbidden' };
  }
  if (account.current_owned_tenant_id) {
    return { kind: 'owned_tenant' };
  }
  const row = await lockOwnerOnboarding(client, onboardingId, principalId);
  if (!row) {
    return { kind: 'not_found_or_forbidden' };
  }
  if (row.status !== 'incomplete' && row.status !== 'payment_pending') {
    return { kind: 'not_selectable', onboarding: toOwnerOnboarding(row) };
  }
  // Retired plans (migration 0063) stay for existing subscriptions but must not be chosen: bootstrap
  // would refuse them later and leave the owner stuck on an onboarding that can never finish.
  const plan = await client.query<{ available: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM plan WHERE code = $1 AND active) AS available',
    [planCode],
  );
  if (plan.rows[0]?.available !== true) {
    return { kind: 'plan_unavailable' };
  }

  const nextStatus: OnboardingStatus = account.trial_consumed_at ? 'payment_pending' : 'incomplete';
  const updated = await client.query<OnboardingRow>(
    `UPDATE organization_onboarding
     SET selected_plan_code = $2, status = $3, updated_at = now()
     WHERE id = $1 AND status IN ('incomplete', 'payment_pending')
     RETURNING id, account_id, clerk_org_id, organization_name, requested_slug, status, selected_plan_code,
               provisioned_tenant_id, created_at, updated_at`,
    [onboardingId, planCode, nextStatus],
  );
  const updatedRow = updated.rows[0];
  if (!updatedRow) {
    const current = await lockOwnerOnboarding(client, onboardingId, principalId);
    return current
      ? { kind: 'not_selectable', onboarding: toOwnerOnboarding(current) }
      : { kind: 'not_found_or_forbidden' };
  }
  return {
    kind: 'updated',
    onboarding: toOwnerOnboarding({
      ...updatedRow,
      trial_consumed_at: account.trial_consumed_at,
    }),
  };
}

/** Append one immutable, verified operator payment record using a stable business key. */
export async function recordVerifiedOnboardingPayment(
  onboardingId: string,
  operatorSubject: string,
  evidence: {
    amountMinor: string;
    currency: 'PHP';
    paymentReference: string;
    businessKey: string;
  },
): Promise<RecordOnboardingPaymentResult> {
  return withOperatorGlobalTransaction(operatorSubject, async (client) => {
    const onboarding = await client.query<{ status: string; provisioned_tenant_id: string | null }>(
      `SELECT status, provisioned_tenant_id
       FROM organization_onboarding
       WHERE id = $1
       FOR UPDATE`,
      [onboardingId],
    );
    const onboardingRow = onboarding.rows[0];
    if (!onboardingRow) {
      return { kind: 'not_found_or_forbidden' };
    }
    if (onboardingRow.status !== 'payment_pending' || onboardingRow.provisioned_tenant_id) {
      return { kind: 'onboarding_not_payment_pending' };
    }

    const inserted = await client.query<PaymentRow>(
      `INSERT INTO onboarding_payment_verification
         (organization_onboarding_id, operator_subject, amount_minor, currency,
          payment_reference, status, business_key)
       VALUES ($1, $2, $3, $4, $5, 'verified', $6)
       ON CONFLICT (business_key) DO NOTHING
       RETURNING id, organization_onboarding_id, operator_subject, amount_minor::text,
                 currency, payment_reference, status, business_key, created_at`,
      [
        onboardingId,
        operatorSubject,
        evidence.amountMinor,
        evidence.currency,
        evidence.paymentReference,
        evidence.businessKey,
      ],
    );
    if (inserted.rows[0]) {
      return { kind: 'recorded', payment: toOperatorPayment(inserted.rows[0]) };
    }

    const existing = await client.query<PaymentRow>(
      `SELECT id, organization_onboarding_id, operator_subject, amount_minor::text,
              currency, payment_reference, status, business_key, created_at
       FROM onboarding_payment_verification
       WHERE business_key = $1`,
      [evidence.businessKey],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      return { kind: 'business_key_conflict' };
    }
    const sameEvidence =
      existingRow.organization_onboarding_id === onboardingId &&
      existingRow.operator_subject === operatorSubject &&
      existingRow.amount_minor === evidence.amountMinor &&
      existingRow.currency === evidence.currency &&
      existingRow.payment_reference === evidence.paymentReference &&
      existingRow.status === 'verified';
    return sameEvidence
      ? { kind: 'replayed', payment: toOperatorPayment(existingRow) }
      : { kind: 'business_key_conflict' };
  });
}

/** Owner projection: status and timestamps only; payment evidence stays operator-only. */
export async function listOwnerPaymentStatuses(
  onboardingId: string,
  principalId: string,
): Promise<OwnerPaymentStatus[]> {
  return withGlobalTransaction(principalId, async (client) => {
    const result = await client.query<{ id: string; status: string; created_at: Date }>(
      `SELECT p.id, p.status, p.created_at
       FROM onboarding_payment_verification p
       JOIN organization_onboarding o ON o.id = p.organization_onboarding_id
       JOIN account a ON a.id = o.account_id
       WHERE p.organization_onboarding_id = $1
         AND a.clerk_user_id = $2
       ORDER BY p.created_at ASC, p.id ASC`,
      [onboardingId, principalId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: requireVerifiedStatus(row.status),
      createdAt: row.created_at,
    }));
  });
}

const onboardingSelect = `SELECT o.id, o.account_id, o.clerk_org_id, o.organization_name,
  o.requested_slug, o.status,
  o.selected_plan_code, o.provisioned_tenant_id, a.trial_consumed_at,
  o.created_at, o.updated_at`;

async function lockAccount(
  client: PoolClient,
  accountId: string,
  principalId: string,
): Promise<AccountLifecycleRow | null> {
  const result = await client.query<AccountLifecycleRow>(
    `SELECT id, trial_consumed_at, current_owned_tenant_id
     FROM account
     WHERE id = $1 AND clerk_user_id = $2
     FOR UPDATE`,
    [accountId, principalId],
  );
  return result.rows[0] ?? null;
}

async function findOwnerAccountId(
  client: PoolClient,
  onboardingId: string,
  principalId: string,
): Promise<string | null> {
  const result = await client.query<{ account_id: string }>(
    `SELECT o.account_id
     FROM organization_onboarding o
     JOIN account a ON a.id = o.account_id
     WHERE o.id = $1 AND a.clerk_user_id = $2`,
    [onboardingId, principalId],
  );
  return result.rows[0]?.account_id ?? null;
}

async function lockOwnerOnboarding(
  client: PoolClient,
  onboardingId: string,
  principalId: string,
): Promise<OnboardingRow | null> {
  const result = await client.query<OnboardingRow>(
    `${onboardingSelect}
     FROM organization_onboarding o
     JOIN account a ON a.id = o.account_id
     WHERE o.id = $1 AND a.clerk_user_id = $2
     FOR UPDATE OF o`,
    [onboardingId, principalId],
  );
  return result.rows[0] ?? null;
}

function toOwnerOnboarding(row: OnboardingRow): OwnerOnboardingRecord {
  return {
    id: row.id,
    clerkOrgId: row.clerk_org_id,
    organizationName: row.organization_name,
    requestedSlug: row.requested_slug,
    status: requireOnboardingStatus(row.status),
    selectedPlanCode: row.selected_plan_code ? requirePlanCode(row.selected_plan_code) : null,
    isTrialEligible: row.trial_consumed_at === null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOperatorPayment(row: PaymentRow): OperatorPaymentRecord {
  return {
    id: row.id,
    onboardingId: row.organization_onboarding_id,
    operatorSubject: row.operator_subject,
    amountMinor: row.amount_minor,
    currency: requirePhp(row.currency),
    paymentReference: row.payment_reference,
    status: requireVerifiedStatus(row.status),
    businessKey: row.business_key,
    createdAt: row.created_at,
  };
}

function requireOnboardingStatus(value: string): OnboardingStatus {
  if (
    value === 'incomplete' ||
    value === 'abandoned' ||
    value === 'payment_pending' ||
    value === 'provisioned'
  ) {
    return value;
  }
  throw new Error(`Unexpected onboarding status from database: ${value}`);
}

function requirePlanCode(value: string): PlanCode {
  if (value === 'starter' || value === 'professional' || value === 'business') {
    return value;
  }
  throw new Error(`Unexpected onboarding plan code from database: ${value}`);
}

function requirePhp(value: string): 'PHP' {
  if (value === 'PHP') {
    return value;
  }
  throw new Error(`Unexpected onboarding payment currency from database: ${value}`);
}

function requireVerifiedStatus(value: string): 'verified' {
  if (value === 'verified') {
    return value;
  }
  throw new Error(`Unexpected onboarding payment status from database: ${value}`);
}
