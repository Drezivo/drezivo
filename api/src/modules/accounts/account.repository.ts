import type { PoolClient } from 'pg';

import { withGlobalTransaction } from '../../db/client.js';

/**
 * TBF-010 — minimal global account persistence. The account row is the single serialization
 * point for "one lifetime trial" and "one current owned tenant" per verified person: every
 * state change is a conditional UPDATE under the account row lock, so concurrent callers
 * produce exactly one winner and a loser that sees the winner's committed state — never a
 * lost update or a double claim. All operations run in the pre-tenant context
 * (`withGlobalTransaction`), which cannot touch tenant-owned rows at all.
 *
 * Returns are narrow result unions, not raw rows: the caller (later TBF bootstrap/claim
 * services) maps them to typed application errors or DTOs. Nothing here reads or stores Clerk
 * profile data — `clerk_user_id` is the only identity field on the record by design.
 */

export interface AccountRecord {
  id: string;
  clerkUserId: string;
  trialConsumedAt: Date | null;
  currentOwnedTenantId: string | null;
}

export type TrialClaimResult = 'consumed' | 'already_consumed' | 'not_found_or_forbidden';

export type OwnedTenantClaimResult =
  | 'claimed'
  | 'slot_occupied'
  | 'tenant_already_owned'
  | 'not_found_or_forbidden';

interface AccountRow {
  id: string;
  clerk_user_id: string;
  trial_consumed_at: Date | null;
  current_owned_tenant_id: string | null;
}

function toRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    trialConsumedAt: row.trial_consumed_at,
    currentOwnedTenantId: row.current_owned_tenant_id,
  };
}

/** Idempotent: creates the account on first sight of a Clerk user, returns the existing row otherwise. */
export async function ensureAccount(clerkUserId: string): Promise<AccountRecord> {
  return withGlobalTransaction(clerkUserId, async (client: PoolClient) => {
    const inserted = await client.query<AccountRow>(
      `INSERT INTO account (clerk_user_id)
       VALUES ($1)
       ON CONFLICT (clerk_user_id) DO NOTHING
       RETURNING id, clerk_user_id, trial_consumed_at, current_owned_tenant_id`,
      [clerkUserId],
    );
    if (inserted.rows[0]) {
      return toRecord(inserted.rows[0]);
    }
    const existing = await findAccountRow(client, clerkUserId);
    if (!existing) {
      // Unreachable behind the row-level uniqueness guarantee, but fail loudly rather than
      // fabricate a record if the invariant is ever broken.
      throw new Error('Account vanished between ON CONFLICT and SELECT');
    }
    return toRecord(existing);
  });
}

export async function getAccountByClerkUserId(clerkUserId: string): Promise<AccountRecord | null> {
  return withGlobalTransaction(clerkUserId, async (client: PoolClient) => {
    const row = await findAccountRow(client, clerkUserId);
    return row ? toRecord(row) : null;
  });
}

async function findAccountRow(client: PoolClient, clerkUserId: string): Promise<AccountRow | null> {
  const existing = await client.query<AccountRow>(
    `SELECT id, clerk_user_id, trial_consumed_at, current_owned_tenant_id
     FROM account WHERE clerk_user_id = $1`,
    [clerkUserId],
  );
  return existing.rows[0] ?? null;
}

/**
 * Consumes the person's one lifetime trial. `SELECT ... FOR UPDATE` serializes concurrent
 * callers on the account row; the conditional `UPDATE ... WHERE trial_consumed_at IS NULL`
 * then admits exactly one of them — the loser sees `already_consumed` with the winner's
 * timestamp already committed. Uses database time (`now()`), never application-clock time.
 */
export async function consumeTrial(accountId: string, principalId: string): Promise<TrialClaimResult> {
  return withGlobalTransaction(principalId, async (client: PoolClient) => {
    const account = await client.query<{ trial_consumed_at: Date | null }>(
      `SELECT trial_consumed_at
       FROM account
       WHERE id = $1 AND clerk_user_id = $2
       FOR UPDATE`,
      [accountId, principalId],
    );
    const row = account.rows[0];
    if (!row) {
      return 'not_found_or_forbidden';
    }
    if (row.trial_consumed_at) {
      return 'already_consumed';
    }
    const consumed = await client.query<{ trial_consumed_at: Date }>(
      `UPDATE account
       SET trial_consumed_at = now(), updated_at = now()
       WHERE id = $1 AND clerk_user_id = $2 AND trial_consumed_at IS NULL
       RETURNING trial_consumed_at`,
      [accountId, principalId],
    );
    return consumed.rows[0] ? 'consumed' : 'already_consumed';
  });
}

/**
 * Claims the account's one current-owned-tenant slot. Conditional on the slot being free, so
 * two concurrent claims by the same account produce one `claimed` and one `slot_occupied`.
 * A second account claiming the SAME tenant fails on the reverse UNIQUE constraint
 * (`account_current_owned_tenant_id_key`, migration 0009) and maps to `tenant_already_owned`.
 * Re-claiming the tenant this account already owns is an idempotent `claimed`.
 */
export async function claimOwnedTenant(
  accountId: string,
  tenantId: string,
  principalId: string,
): Promise<OwnedTenantClaimResult> {
  try {
    return await withGlobalTransaction(principalId, async (client: PoolClient) => {
      const claimed = await client.query<{ id: string }>(
        `UPDATE account
         SET current_owned_tenant_id = $2, updated_at = now()
         WHERE id = $1 AND clerk_user_id = $3 AND current_owned_tenant_id IS NULL
         RETURNING id`,
        [accountId, tenantId, principalId],
      );
      if (claimed.rows[0]) {
        return 'claimed' satisfies OwnedTenantClaimResult;
      }
      const current = await client.query<{ current_owned_tenant_id: string | null }>(
        'SELECT current_owned_tenant_id FROM account WHERE id = $1 AND clerk_user_id = $2',
        [accountId, principalId],
      );
      const currentTenantId = current.rows[0]?.current_owned_tenant_id;
      if (currentTenantId === undefined) {
        return 'not_found_or_forbidden';
      }
      return currentTenantId === tenantId ? 'claimed' : 'slot_occupied';
    });
  } catch (error) {
    if (isUniqueViolationOnOwnedTenant(error)) {
      return 'tenant_already_owned';
    }
    throw error;
  }
}

/**
 * Releases the owned-tenant link ONLY when this account currently owns that exact tenant —
 * the closure path (TBF-053) must never release another account's claim. Idempotent: a repeat
 * release returns false.
 */
export async function releaseOwnedTenant(
  accountId: string,
  tenantId: string,
  principalId: string,
): Promise<boolean> {
  return withGlobalTransaction(principalId, async (client: PoolClient) => {
    const released = await client.query<{ id: string }>(
      `UPDATE account
       SET current_owned_tenant_id = NULL, updated_at = now()
       WHERE id = $1 AND current_owned_tenant_id = $2 AND clerk_user_id = $3
       RETURNING id`,
      [accountId, tenantId, principalId],
    );
    return released.rows[0] !== undefined;
  });
}

function isUniqueViolationOnOwnedTenant(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'account_current_owned_tenant_id_key'
  );
}
