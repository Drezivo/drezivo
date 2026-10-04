import { describe, expect, it } from 'vitest';

import { handleTenantBootstrapped } from '../tenant-bootstrap.js';

describe('tenant.bootstrapped worker handler', () => {
  it('acknowledges the durable extension event without an external side effect', async () => {
    await expect(
      handleTenantBootstrapped({
        id: 'outbox-id',
        tenant_id: 'tenant-id',
        dedupe_key: 'tenant-bootstrap:tenant-id',
        event_type: 'tenant.bootstrapped',
        payload: { tenant_id: 'tenant-id' },
        attempts: 0,
        max_attempts: 8,
      }),
    ).resolves.toBeUndefined();
  });
});
