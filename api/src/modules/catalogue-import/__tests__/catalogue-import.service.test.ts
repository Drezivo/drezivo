import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DependencyUnavailableError, ValidationError } from '../../../shared/errors.js';

const createClothing = vi.hoisted(() => vi.fn());
vi.mock('../../catalogue/catalogue.service.js', () => ({ createClothing }));
vi.mock('../../files/files.service.js', () => ({ authorizeUpload: vi.fn(), finalizeUpload: vi.fn() }));

const { createImportClothing } = await import('../catalogue-import.service.js');

const context = {
  tenantId: 't',
  branchId: 'b',
  membershipId: 'm',
  principalId: 'p',
  permissionCodes: [],
  effectiveTenantStatus: 'active' as const,
  requestId: 'req-1',
};
const items = ['row-key-0001', 'row-key-0002', 'row-key-0003'].map((key) => ({
  idempotency_key: key,
  request: { name: key },
}));

describe('createImportClothing', () => {
  beforeEach(() => createClothing.mockReset());

  it('passes each row its own idempotency key and keeps a row failure on that row', async () => {
    createClothing
      .mockResolvedValueOnce({ status: 201, body: { success: true } })
      .mockRejectedValueOnce(new ValidationError('Clothing request is invalid.'))
      .mockResolvedValueOnce({ status: 201, body: { success: true } });

    const results = await createImportClothing(context, { items });

    const keys = createClothing.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(['row-key-0001', 'row-key-0002', 'row-key-0003']);
    expect(results.map((row) => row.status)).toEqual([201, 422, 201]);
    expect(results[1]?.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
      request_id: 'req-1',
    });
  });

  it('stops at a dependency outage and marks the untried rows for retry', async () => {
    createClothing
      .mockResolvedValueOnce({ status: 201, body: { success: true } })
      .mockRejectedValueOnce(new DependencyUnavailableError('Database is unavailable.'));

    const results = await createImportClothing(context, { items });

    expect(createClothing).toHaveBeenCalledTimes(2);
    expect(results.map((row) => row.status)).toEqual([201, 503, 503]);
    expect(results.map((row) => row.idempotency_key)).toEqual(items.map((item) => item.idempotency_key));
  });
});
