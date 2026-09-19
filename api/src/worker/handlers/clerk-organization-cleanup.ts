import { randomUUID } from 'node:crypto';

import { config } from '../../config/index.js';
import { pool } from '../../db/client.js';
import { createClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import { logger } from '../../shared/logger.js';

type CleanupJob = {
  id: string;
  onboarding_id: string;
  account_id: string;
  clerk_org_id: string;
  attempts: number;
  max_attempts: number;
  lease_token: string;
};

type CleanupSafety = {
  onboarding_status: string;
  provisioned_tenant_id: string | null;
  onboarding_clerk_org_id: string;
  tenant_exists: boolean;
  provider_created_by_onboarding: boolean;
};

/**
 * Delete Clerk organizations only after Drezivo has durably abandoned the corresponding owner
 * onboarding. The queue is global/pre-tenant, so this sweep uses the dedicated worker policy
 * rather than the tenant outbox. Every destructive provider call is preceded by a fresh DB
 * safety check; a provisioned or otherwise unverified organization is dead-lettered, never deleted.
 */
export async function cleanupAbandonedClerkOrganizations(limit = 10): Promise<void> {
  const jobs = await claimCleanupJobs(limit);
  for (const job of jobs) {
    await processCleanupJob(job);
  }
}

async function claimCleanupJobs(limit: number): Promise<CleanupJob[]> {
  const leaseToken = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<Omit<CleanupJob, 'lease_token'>>(
      `WITH due AS (
         SELECT id
         FROM clerk_organization_cleanup_job
         WHERE (status = 'pending' AND available_at <= now())
            OR (status = 'leased' AND lease_until < now())
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE clerk_organization_cleanup_job j
       SET status = 'leased', lease_token = $2,
           lease_until = now() + make_interval(secs => $3), updated_at = now()
       FROM due
       WHERE j.id = due.id
       RETURNING j.id, j.onboarding_id, j.account_id, j.clerk_org_id,
                 j.attempts, j.max_attempts`,
      [limit, leaseToken, config.WORKER_LEASE_SECONDS],
    );
    await client.query('COMMIT');
    return result.rows.map((row) => ({ ...row, lease_token: leaseToken }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processCleanupJob(job: CleanupJob): Promise<void> {
  try {
    const safety = await loadCleanupSafety(job);
    if (!safety) {
      await markDead(job, 'cleanup target missing');
      return;
    }
    if (
      safety.onboarding_status !== 'abandoned' ||
      safety.provisioned_tenant_id !== null ||
      safety.onboarding_clerk_org_id !== job.clerk_org_id ||
      safety.tenant_exists ||
      !safety.provider_created_by_onboarding
    ) {
      await markDead(job, 'cleanup safety check rejected');
      logger.error(
        { cleanupJobId: job.id, onboardingId: job.onboarding_id },
        'refused to delete Clerk organization because cleanup safety checks failed',
      );
      return;
    }

    await createClerkServerAdapter().deleteOrganizationIfPresent(job.clerk_org_id);
    await pool.query(
      `UPDATE clerk_organization_cleanup_job
       SET status = 'succeeded', completed_at = now(), updated_at = now(),
           lease_token = NULL, lease_until = NULL, safe_last_error = NULL
       WHERE id = $1 AND lease_token = $2`,
      [job.id, job.lease_token],
    );
  } catch (error) {
    await retryOrDie(job, error);
  }
}

async function loadCleanupSafety(job: CleanupJob): Promise<CleanupSafety | null> {
  const result = await pool.query<CleanupSafety>(
    `SELECT o.status AS onboarding_status,
            o.provisioned_tenant_id,
            o.clerk_org_id AS onboarding_clerk_org_id,
            EXISTS (
              SELECT 1 FROM tenant t WHERE t.clerk_org_id = j.clerk_org_id
            ) AS tenant_exists,
            EXISTS (
              SELECT 1
              FROM owner_onboarding_attempt a
              WHERE a.account_id = j.account_id
                AND a.provider_org_id = j.clerk_org_id
                AND a.status IN ('provider_created', 'local_persisted')
            ) AS provider_created_by_onboarding
     FROM clerk_organization_cleanup_job j
     JOIN organization_onboarding o ON o.id = j.onboarding_id
     WHERE j.id = $1
       AND j.account_id = $2
       AND j.onboarding_id = $3`,
    [job.id, job.account_id, job.onboarding_id],
  );
  return result.rows[0] ?? null;
}

async function retryOrDie(job: CleanupJob, error: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const safeMessage = error instanceof Error ? error.message : 'provider cleanup failed';
  if (attempts >= job.max_attempts) {
    await markDead(job, safeMessage);
    return;
  }

  const backoffSeconds = Math.min(2 ** attempts, 3600) + Math.random() * 5;
  await pool.query(
    `UPDATE clerk_organization_cleanup_job
     SET status = 'pending', attempts = $3, safe_last_error = $4,
         available_at = now() + make_interval(secs => $5),
         lease_token = NULL, lease_until = NULL, updated_at = now()
     WHERE id = $1 AND lease_token = $2`,
    [job.id, job.lease_token, attempts, safeMessage, backoffSeconds],
  );
  logger.warn(
    { cleanupJobId: job.id, attempts },
    'Clerk organization cleanup failed; queued for retry',
  );
}

async function markDead(job: CleanupJob, safeMessage: string): Promise<void> {
  await pool.query(
    `UPDATE clerk_organization_cleanup_job
     SET status = 'dead', attempts = attempts + 1, safe_last_error = $3,
         lease_token = NULL, lease_until = NULL, updated_at = now()
     WHERE id = $1 AND lease_token = $2`,
    [job.id, job.lease_token, safeMessage],
  );
}
