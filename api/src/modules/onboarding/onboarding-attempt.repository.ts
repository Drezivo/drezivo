import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { AccountRecord } from '../accounts/account.repository.js';
import {
  claimBootstrapIdempotency,
  type BootstrapIdempotencyClaim,
} from '../bootstrap/bootstrap.repository.js';

export interface OwnerOnboardingAttemptRecord {
  id: string;
  accountId: string;
  idempotencyRecordId: string;
  attemptId: string;
  organizationName: string;
  requestedSlug: string | null;
  providerOrgId: string | null;
  status: 'pending' | 'provider_created' | 'local_persisted' | 'failed';
}

export type OwnerOnboardingStartClaim = {
  account: AccountRecord;
  claim: BootstrapIdempotencyClaim;
  attempt: OwnerOnboardingAttemptRecord | null;
  otherInProgress: boolean;
};

/**
 * Claims the owner-start operation while holding the account row lock. The lock is held only
 * for the local claim/attempt transaction; the external Clerk call happens after commit.
 */
export async function claimOwnerOnboardingStart(
  client: PoolClient,
  input: {
    account: AccountRecord;
    operation: string;
    intentKey: string;
    payloadHash: string;
    organizationName: string;
    requestedSlug: string | null;
  },
): Promise<OwnerOnboardingStartClaim> {
  const locked = await client.query<{
    id: string;
    clerk_user_id: string;
    trial_consumed_at: Date | null;
    current_owned_tenant_id: string | null;
  }>(
    `SELECT id, clerk_user_id, trial_consumed_at, current_owned_tenant_id
     FROM account WHERE id = $1 AND clerk_user_id = $2 FOR UPDATE`,
    [input.account.id, input.account.clerkUserId],
  );
  const row = locked.rows[0];
  if (!row) {
    throw new Error('Account disappeared while claiming onboarding.');
  }
  const account: AccountRecord = {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    trialConsumedAt: row.trial_consumed_at,
    currentOwnedTenantId: row.current_owned_tenant_id,
  };

  let claim = await claimBootstrapIdempotency(client, {
    accountId: account.id,
    operation: input.operation,
    intentKey: input.intentKey,
    payloadHash: input.payloadHash,
  });

  let attempt: OwnerOnboardingAttemptRecord | null = null;
  if (claim.kind === 'claimed') {
    const unresolved = await findAttemptByIdempotency(client, claim.recordId, account.id, true);
    if (unresolved && (unresolved.status === 'pending' || unresolved.status === 'provider_created')) {
      claim = { kind: 'in_progress', recordId: claim.recordId, expiresAt: claim.expiresAt };
      attempt = unresolved;
    }
  }
  if (claim.kind === 'claimed') {
    const inserted = await client.query<AttemptRow>(
      `INSERT INTO owner_onboarding_attempt
         (account_id, idempotency_record_id, attempt_id, organization_name, requested_slug, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, account_id, idempotency_record_id, attempt_id, organization_name,
                 requested_slug, provider_org_id, status`,
      [
        account.id,
        claim.recordId,
        randomUUID(),
        input.organizationName,
        input.requestedSlug,
      ],
    );
    attempt = inserted.rows[0] ? toAttempt(inserted.rows[0]) : null;
  } else if (claim.kind === 'in_progress') {
    attempt = await findAttemptByIdempotency(client, claim.recordId, account.id);
  }

  const other = await client.query<{ id: string }>(
    `SELECT id FROM bootstrap_idempotency_record
     WHERE account_id = $1 AND operation = $2 AND status = 'in_progress'
       AND expires_at > now() AND id <> $3
     LIMIT 1`,
    [account.id, input.operation, claim.recordId],
  );

  return {
    account,
    claim,
    attempt,
    otherInProgress: Boolean(other.rows[0]),
  };
}

export async function markOwnerAttemptProviderCreated(
  client: PoolClient,
  attemptId: string,
  providerOrgId: string,
): Promise<void> {
  await client.query(
    `UPDATE owner_onboarding_attempt
     SET provider_org_id = $2, status = 'provider_created', updated_at = now()
     WHERE attempt_id = $1 AND status = 'pending'`,
    [attemptId, providerOrgId],
  );
}

export async function markOwnerAttemptLocalPersisted(
  client: PoolClient,
  attemptId: string,
): Promise<void> {
  await client.query(
    `UPDATE owner_onboarding_attempt
     SET status = 'local_persisted', updated_at = now()
     WHERE attempt_id = $1 AND status IN ('pending', 'provider_created')`,
    [attemptId],
  );
}

export async function markOwnerAttemptFailed(client: PoolClient, attemptId: string): Promise<void> {
  await client.query(
    `UPDATE owner_onboarding_attempt
     SET status = 'failed', updated_at = now()
     WHERE attempt_id = $1 AND status = 'pending'`,
    [attemptId],
  );
}

export async function findOwnerAttemptByIdempotency(
  client: PoolClient,
  recordId: string,
  accountId: string,
): Promise<OwnerOnboardingAttemptRecord | null> {
  return findAttemptByIdempotency(client, recordId, accountId);
}

export async function findOwnerOnboardingByAttempt(
  client: PoolClient,
  accountId: string,
  attemptId: string,
): Promise<{ onboardingId: string; providerOrgId: string } | null> {
  const result = await client.query<{ id: string; clerk_org_id: string }>(
    `SELECT o.id, o.clerk_org_id
     FROM organization_onboarding o
     JOIN owner_onboarding_attempt a ON a.provider_org_id = o.clerk_org_id
     WHERE a.account_id = $1 AND a.attempt_id = $2
       AND o.account_id = $1 AND o.status IN ('incomplete', 'payment_pending')`,
    [accountId, attemptId],
  );
  const row = result.rows[0];
  return row ? { onboardingId: row.id, providerOrgId: row.clerk_org_id } : null;
}

interface AttemptRow {
  id: string;
  account_id: string;
  idempotency_record_id: string;
  attempt_id: string;
  organization_name: string;
  requested_slug: string | null;
  provider_org_id: string | null;
  status: string;
}

async function findAttemptByIdempotency(
  client: PoolClient,
  recordId: string,
  accountId: string,
  unresolvedOnly = false,
): Promise<OwnerOnboardingAttemptRecord | null> {
  const result = await client.query<AttemptRow>(
    `SELECT id, account_id, idempotency_record_id, attempt_id, organization_name,
            requested_slug, provider_org_id, status
     FROM owner_onboarding_attempt
     WHERE idempotency_record_id = $1 AND account_id = $2
       ${unresolvedOnly ? "AND status IN ('pending', 'provider_created')" : ''}
     ORDER BY created_at DESC
     LIMIT 1`,
    [recordId, accountId],
  );
  return result.rows[0] ? toAttempt(result.rows[0]) : null;
}

function toAttempt(row: AttemptRow): OwnerOnboardingAttemptRecord {
  if (
    row.status !== 'pending' &&
    row.status !== 'provider_created' &&
    row.status !== 'local_persisted' &&
    row.status !== 'failed'
  ) {
    throw new Error(`Unexpected owner onboarding attempt status: ${row.status}`);
  }
  return {
    id: row.id,
    accountId: row.account_id,
    idempotencyRecordId: row.idempotency_record_id,
    attemptId: row.attempt_id,
    organizationName: row.organization_name,
    requestedSlug: row.requested_slug,
    providerOrgId: row.provider_org_id,
    status: row.status,
  };
}
