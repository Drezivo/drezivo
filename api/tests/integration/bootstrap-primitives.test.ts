import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import { canonicalRequestHash } from '../../src/shared/idempotency.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('TBF-012 bootstrap idempotency and global audit primitives', async () => {
  const {
    closePool,
    withGlobalTransaction,
    withOperatorGlobalTransaction,
    withSystemGlobalTransaction,
    withTenantTransaction,
  } = await import('../../src/db/client.js');
  const { ensureAccount } = await import('../../src/modules/accounts/account.repository.js');
  const {
    claimBootstrapIdempotency,
    finalizeBootstrapIdempotency,
  } = await import('../../src/modules/bootstrap/bootstrap.repository.js');
  const {
    appendGlobalAuditEvent,
    readGlobalAuditEvents,
  } = await import('../../src/modules/audit/global-audit.repository.js');
  const { createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('replays the original response for a sequential same-key retry', async () => {
    const account = await ensureAccount('user_tbf012_replay');
    const input = claimInput(account.id, 'onboarding.create', 'replay-key', { plan: 'starter' });
    const claimed = await withGlobalTransaction('user_tbf012_replay', (client) =>
      claimBootstrapIdempotency(client, input),
    );
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') throw new Error('expected claim');

    await withGlobalTransaction('user_tbf012_replay', (client) =>
      finalizeBootstrapIdempotency(client, {
        ...input,
        recordId: claimed.recordId,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: { success: true, data: { onboarding_id: 'safe-id' } },
      }),
    );

    const replay = await withGlobalTransaction('user_tbf012_replay', (client) =>
      claimBootstrapIdempotency(client, input),
    );
    expect(replay).toMatchObject({
      kind: 'replayed',
      status: 'succeeded',
      responseCode: 201,
      safeResponse: { success: true, data: { onboarding_id: 'safe-id' } },
    });
  });

  it('serializes concurrent same-key work into one business effect and audit event', async () => {
    const account = await ensureAccount('user_tbf012_concurrent');
    const input = claimInput(account.id, 'onboarding.create', 'concurrent-key', { plan: 'business' });
    const run = () =>
      withGlobalTransaction('user_tbf012_concurrent', async (client) => {
        const claim = await claimBootstrapIdempotency(client, input);
        if (claim.kind !== 'claimed') return claim;
        await client.query(
          `INSERT INTO organization_onboarding (account_id, clerk_org_id)
           VALUES ($1, $2)`,
          [account.id, 'org_tbf012_concurrent'],
        );
        await appendGlobalAuditEvent(client, {
          accountId: account.id,
          actorKind: 'account',
          actorKey: 'user_tbf012_concurrent',
          action: 'onboarding.created',
          entityType: 'organization_onboarding',
          outcome: 'succeeded',
          redactedSummary: { operation: input.operation },
          requestId: 'req-tbf012-concurrent',
        });
        return finalizeBootstrapIdempotency(client, {
          ...input,
          recordId: claim.recordId,
          status: 'succeeded',
          responseCode: 201,
          safeResponse: { success: true },
        });
      });

    const results = await Promise.all([run(), run()]);
    expect(results.filter((result) => result.kind === 'finalized')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'replayed')).toHaveLength(1);

    const counts = await withGlobalTransaction('user_tbf012_concurrent', async (client) => {
      const effect = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization_onboarding',
      );
      const audit = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM global_audit_event',
      );
      return { effect: effect.rows[0]?.count ?? -1, audit: audit.rows[0]?.count ?? -1 };
    });
    expect(counts).toEqual({ effect: 1, audit: 1 });
  });

  it('rejects a changed payload under the same key and does not create a second effect', async () => {
    const account = await ensureAccount('user_tbf012_key_reuse');
    const first = claimInput(account.id, 'onboarding.create', 'same-key', { plan: 'starter' });
    const changed = claimInput(account.id, 'onboarding.create', 'same-key', { plan: 'business' });
    const claimed = await withGlobalTransaction('user_tbf012_key_reuse', (client) =>
      claimBootstrapIdempotency(client, first),
    );
    if (claimed.kind !== 'claimed') throw new Error('expected claim');
    await withGlobalTransaction('user_tbf012_key_reuse', (client) =>
      finalizeBootstrapIdempotency(client, {
        ...first,
        recordId: claimed.recordId,
        status: 'failed',
        responseCode: 422,
        safeResponse: { success: false, error: { code: 'VALIDATION_FAILED' } },
      }),
    );
    const result = await withGlobalTransaction('user_tbf012_key_reuse', (client) =>
      claimBootstrapIdempotency(client, changed),
    );
    expect(result.kind).toBe('key_reused');
  });

  it('does not collide across accounts or operations and reclaims expired records', async () => {
    const firstAccount = await ensureAccount('user_tbf012_scope_a');
    const secondAccount = await ensureAccount('user_tbf012_scope_b');
    const first = claimInput(firstAccount.id, 'onboarding.create', 'same-key', { x: 1 });
    const otherAccount = claimInput(secondAccount.id, 'onboarding.create', 'same-key', { x: 1 });
    const otherOperation = claimInput(firstAccount.id, 'onboarding.select-plan', 'same-key', { x: 1 });
    expect(
      (await withGlobalTransaction('user_tbf012_scope_a', (client) =>
        claimBootstrapIdempotency(client, first),
      )).kind,
    ).toBe('claimed');
    expect(
      (await withGlobalTransaction('user_tbf012_scope_b', (client) =>
        claimBootstrapIdempotency(client, otherAccount),
      )).kind,
    ).toBe('claimed');
    expect(
      (await withGlobalTransaction('user_tbf012_scope_a', (client) =>
        claimBootstrapIdempotency(client, otherOperation),
      )).kind,
    ).toBe('claimed');

    await withGlobalTransaction('user_tbf012_scope_a', async (client) => {
      await client.query(
        `UPDATE bootstrap_idempotency_record
         SET expires_at = now() - interval '1 second'
         WHERE account_id = $1 AND operation = $2 AND intent_key = $3`,
        [first.accountId, first.operation, first.intentKey],
      );
    });
    const reclaimed = await withGlobalTransaction('user_tbf012_scope_a', (client) =>
      claimBootstrapIdempotency(client, first),
    );
    expect(reclaimed.kind).toBe('claimed');
  });

  it('returns in-progress immediately for a committed claim not yet finalized', async () => {
    const account = await ensureAccount('user_tbf012_in_progress');
    const input = claimInput(account.id, 'onboarding.create', 'pending-key', { plan: 'starter' });
    const claimed = await withGlobalTransaction('user_tbf012_in_progress', (client) =>
      claimBootstrapIdempotency(client, input),
    );
    if (claimed.kind !== 'claimed') throw new Error('expected claim');
    const pending = await withGlobalTransaction('user_tbf012_in_progress', (client) =>
      claimBootstrapIdempotency(client, input),
    );
    expect(pending.kind).toBe('in_progress');
    await withGlobalTransaction('user_tbf012_in_progress', (client) =>
      finalizeBootstrapIdempotency(client, {
        ...input,
        recordId: claimed.recordId,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: { success: true },
      }),
    );
  });

  it('rolls back idempotency, business, and audit rows together', async () => {
    const account = await ensureAccount('user_tbf012_rollback');
    const input = claimInput(account.id, 'onboarding.create', 'rollback-key', { plan: 'starter' });
    await expect(
      withGlobalTransaction('user_tbf012_rollback', async (client) => {
        const claim = await claimBootstrapIdempotency(client, input);
        if (claim.kind !== 'claimed') throw new Error('expected claim');
        await client.query(
          'INSERT INTO organization_onboarding (account_id, clerk_org_id) VALUES ($1, $2)',
          [account.id, 'org_tbf012_rollback'],
        );
        await appendGlobalAuditEvent(client, {
          accountId: account.id,
          actorKind: 'account',
          actorKey: 'user_tbf012_rollback',
          action: 'onboarding.created',
          entityType: 'organization_onboarding',
          outcome: 'succeeded',
          redactedSummary: {},
          requestId: 'req-tbf012-rollback',
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const after = await withGlobalTransaction('user_tbf012_rollback', async (client) => {
      const claim = await claimBootstrapIdempotency(client, input);
      const business = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization_onboarding',
      );
      const audit = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM global_audit_event',
      );
      return { claim: claim.kind, business: business.rows[0]?.count ?? -1, audit: audit.rows[0]?.count ?? -1 };
    });
    expect(after).toEqual({ claim: 'claimed', business: 0, audit: 0 });
  });

  it('enforces owner and tenant isolation for global records', async () => {
    const owner = await ensureAccount('user_tbf012_owner');
    const input = claimInput(owner.id, 'onboarding.create', 'owner-key', { plan: 'starter' });
    await withGlobalTransaction('user_tbf012_owner', async (client) => {
      await claimBootstrapIdempotency(client, input);
      await appendGlobalAuditEvent(client, {
        accountId: owner.id,
        actorKind: 'account',
        actorKey: 'user_tbf012_owner',
        action: 'onboarding.started',
        entityType: 'organization_onboarding',
        outcome: 'succeeded',
        redactedSummary: {},
        requestId: 'req-tbf012-owner',
      });
    });
    const foreign = await withGlobalTransaction('user_tbf012_other', async (client) => {
      const idempotency = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM bootstrap_idempotency_record',
      );
      const audit = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM global_audit_event',
      );
      return { idempotency: idempotency.rows[0]?.count ?? -1, audit: audit.rows[0]?.count ?? -1 };
    });
    expect(foreign).toEqual({ idempotency: 0, audit: 0 });

    const tenant = await createTestTenant();
    const tenantRead = await withTenantTransaction(tenant.id, 'user_tbf012_owner', async (client) => {
      const idempotency = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM bootstrap_idempotency_record',
      );
      const audit = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM global_audit_event',
      );
      return { idempotency: idempotency.rows[0]?.count ?? -1, audit: audit.rows[0]?.count ?? -1 };
    });
    expect(tenantRead).toEqual({ idempotency: 0, audit: 0 });
  });

  it('persists account, operator, and system actor namespaces with database timestamps', async () => {
    const account = await ensureAccount('user_tbf012_actors');
    const accountEvent = await withGlobalTransaction('user_tbf012_actors', (client) =>
      appendGlobalAuditEvent(client, {
        accountId: account.id,
        actorKind: 'account',
        actorKey: 'user_tbf012_actors',
        action: 'onboarding.started',
        entityType: 'organization_onboarding',
        outcome: 'succeeded',
        redactedSummary: { safe: true },
        requestId: 'req-tbf012-account',
      }),
    );
    const operatorEvent = await withOperatorGlobalTransaction('operator_tbf012', (client) =>
      appendGlobalAuditEvent(client, {
        accountId: account.id,
        actorKind: 'operator',
        actorKey: 'operator_tbf012',
        action: 'onboarding.reviewed',
        entityType: 'organization_onboarding',
        outcome: 'rejected',
        redactedSummary: { reason: 'manual' },
        requestId: 'req-tbf012-operator',
      }),
    );
    const systemEvent = await withSystemGlobalTransaction('bootstrap-worker', (client) =>
      appendGlobalAuditEvent(client, {
        accountId: account.id,
        actorKind: 'system',
        actorKey: 'bootstrap-worker',
        action: 'onboarding.reconciled',
        entityType: 'organization_onboarding',
        outcome: 'failed',
        redactedSummary: { retryable: true },
        requestId: 'req-tbf012-system',
      }),
    );
    await withSystemGlobalTransaction('bootstrap-worker', (client) =>
      appendGlobalAuditEvent(client, {
        accountId: null,
        actorKind: 'system',
        actorKey: 'bootstrap-worker',
        action: 'system.reconciled',
        entityType: 'global_reconciliation',
        outcome: 'succeeded',
        redactedSummary: { safe: true },
        requestId: 'req-tbf012-system-global',
      }),
    );
    expect(accountEvent.createdAt).toBeInstanceOf(Date);
    expect(operatorEvent.actorKind).toBe('operator');
    expect(systemEvent.actorKind).toBe('system');

    const ownerRead = await withGlobalTransaction('user_tbf012_actors', (client) =>
      readGlobalAuditEvents(client, { accountId: account.id }),
    );
    expect(ownerRead).toHaveLength(3);
    expect(ownerRead.map((event) => event.actorKind).sort()).toEqual(['account', 'operator', 'system']);
    const operatorRead = await withOperatorGlobalTransaction('operator_tbf012', (client) =>
      readGlobalAuditEvents(client, { accountId: account.id }),
    );
    expect(operatorRead).toHaveLength(3);
    const systemRead = await withSystemGlobalTransaction('bootstrap-worker', (client) =>
      readGlobalAuditEvents(client, { entityType: 'global_reconciliation' }),
    );
    expect(systemRead).toHaveLength(1);
  });

  it('rejects oversized JSON and keeps global audit immutable for the runtime role', async () => {
    const account = await ensureAccount('user_tbf012_limits');
    const input = claimInput(account.id, 'onboarding.create', 'large-key', { plan: 'starter' });
    const claimed = await withGlobalTransaction('user_tbf012_limits', (client) =>
      claimBootstrapIdempotency(client, input),
    );
    if (claimed.kind !== 'claimed') throw new Error('expected claim');
    await expect(
      withGlobalTransaction('user_tbf012_limits', (client) =>
        finalizeBootstrapIdempotency(client, {
          ...input,
          recordId: claimed.recordId,
          status: 'succeeded',
          responseCode: 200,
          safeResponse: { data: 'x'.repeat(65 * 1024) },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      withGlobalTransaction('user_tbf012_limits', (client) =>
        appendGlobalAuditEvent(client, {
          accountId: account.id,
          actorKind: 'account',
          actorKey: 'user_tbf012_limits',
          action: 'large.summary',
          entityType: 'organization_onboarding',
          outcome: 'failed',
          redactedSummary: { data: 'x'.repeat(65 * 1024) },
          requestId: 'req-tbf012-large',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      withOperatorGlobalTransaction('operator_tbf012', async (client) => {
        await client.query('UPDATE global_audit_event SET action = $1', ['tampered']);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withOperatorGlobalTransaction('operator_tbf012', async (client) => {
        await client.query('DELETE FROM global_audit_event');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

function claimInput(
  accountId: string,
  operation: string,
  intentKey: string,
  payload: unknown,
) {
  return {
    accountId,
    operation,
    intentKey,
    payloadHash: canonicalRequestHash(payload),
  };
}
