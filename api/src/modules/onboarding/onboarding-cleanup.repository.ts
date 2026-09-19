import type { PoolClient } from 'pg';

export async function enqueueClerkOrganizationCleanup(
  client: PoolClient,
  input: { onboardingId: string; accountId: string; clerkOrgId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO clerk_organization_cleanup_job (onboarding_id, account_id, clerk_org_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (onboarding_id) DO NOTHING`,
    [input.onboardingId, input.accountId, input.clerkOrgId],
  );
}
