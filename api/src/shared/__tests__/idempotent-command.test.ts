import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock('../tenant-idempotency.js', () => ({
  claimTenantIdempotency: mocks.claim,
  finalizeTenantIdempotency: mocks.finalize,
}));

import { DependencyUnavailableError, ValidationError } from '../errors.js';
import { runIdempotentCommand } from '../idempotent-command.js';

const scope = {
  tenantId: 'tenant-id',
  principalKey: 'member-id',
  operation: 'replace-image',
  intentKey: 'request-key',
  requestId: 'request-id',
};

describe('runIdempotentCommand', () => {
  beforeEach(() => {
    mocks.claim.mockReset().mockResolvedValue({ kind: 'claimed' });
    mocks.finalize.mockReset().mockResolvedValue(undefined);
  });

  it('lets transient dependency failures roll back without caching an idempotency result', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) } as unknown as PoolClient;
    const unavailable = new DependencyUnavailableError('Temporarily unavailable.');

    await expect(
      runIdempotentCommand(client, scope, { file_id: 'file-id' }, () => Promise.reject(unavailable)),
    ).rejects.toBe(unavailable);

    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('continues to persist deterministic application failures for replay', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) } as unknown as PoolClient;
    const result = await runIdempotentCommand(
      client,
      scope,
      { file_id: 'file-id' },
      () => Promise.reject(new ValidationError('Invalid file.')),
    );

    expect(result.status).toBe(422);
    expect(mocks.finalize).toHaveBeenCalledOnce();
  });
});
