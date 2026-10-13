import type { PoolClient } from 'pg';

import { withGlobalTransaction } from '../../db/client.js';

export interface AccountTermsAcceptanceRecord {
  termsVersion: string;
  acceptedAt: Date;
}

/** Latest account consent is a narrow global projection and remains protected by account RLS. */
export async function getLatestAccountTermsAcceptance(
  principalId: string,
): Promise<AccountTermsAcceptanceRecord | null> {
  return withGlobalTransaction(principalId, async (client) => {
    const result = await client.query<{ terms_version: string; accepted_at: Date }>(
      `SELECT acceptance.terms_version, acceptance.accepted_at
       FROM account_terms_acceptance AS acceptance
       JOIN account ON account.id = acceptance.account_id
       WHERE account.clerk_user_id = $1
       ORDER BY acceptance.accepted_at DESC, acceptance.terms_version DESC
       LIMIT 1`,
      [principalId],
    );
    const row = result.rows[0];
    return row ? { termsVersion: row.terms_version, acceptedAt: row.accepted_at } : null;
  });
}

export async function lockAccountForTermsAcceptance(
  client: PoolClient,
  accountId: string,
  principalId: string,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM account WHERE id = $1 AND clerk_user_id = $2 FOR UPDATE`,
    [accountId, principalId],
  );
  return result.rows.length === 1;
}

export async function getAccountTermsAcceptance(
  client: PoolClient,
  accountId: string,
  termsVersion: string,
): Promise<AccountTermsAcceptanceRecord | null> {
  const result = await client.query<{ terms_version: string; accepted_at: Date }>(
    `SELECT terms_version, accepted_at
     FROM account_terms_acceptance
     WHERE account_id = $1 AND terms_version = $2`,
    [accountId, termsVersion],
  );
  const row = result.rows[0];
  return row ? { termsVersion: row.terms_version, acceptedAt: row.accepted_at } : null;
}

export async function insertAccountTermsAcceptance(
  client: PoolClient,
  accountId: string,
  termsVersion: string,
): Promise<AccountTermsAcceptanceRecord | null> {
  const result = await client.query<{ terms_version: string; accepted_at: Date }>(
    `INSERT INTO account_terms_acceptance (account_id, terms_version)
     VALUES ($1, $2)
     ON CONFLICT (account_id, terms_version) DO NOTHING
     RETURNING terms_version, accepted_at`,
    [accountId, termsVersion],
  );
  const row = result.rows[0];
  return row ? { termsVersion: row.terms_version, acceptedAt: row.accepted_at } : null;
}

export async function hasAccountAcceptedTerms(
  client: PoolClient,
  accountId: string,
  termsVersion: string,
): Promise<boolean> {
  const result = await client.query<{ accepted: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM account_terms_acceptance
       WHERE account_id = $1 AND terms_version = $2
     ) AS accepted`,
    [accountId, termsVersion],
  );
  return result.rows[0]?.accepted === true;
}
