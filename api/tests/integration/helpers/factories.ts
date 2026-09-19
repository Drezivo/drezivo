import { randomUUID } from 'node:crypto';

import { pool, withTenantTransaction } from '../../../src/db/client.js';

/**
 * Minimal row factories for integration tests. This module is ONLY ever imported dynamically
 * AFTER the test file has pinned process.env to the local test database — importing it (or
 * anything that reaches src/db/client.js) statically would construct the app config/pool
 * against the wrong database before the test could intervene. Same discipline as
 * src/__tests__/app.test.ts.
 *
 * Rows are created through the real access paths, not back-door superuser inserts: global
 * tables via the shared pool, tenant-owned rows via `withTenantTransaction` so RLS policies
 * and grants are exercised by every test that uses a factory.
 */

export interface TestTenant {
  id: string;
  clerkOrgId: string;
}

export function testKey(label: string): string {
  return `test-${label}`;
}

export async function createTestTenant(overrides?: { clerkOrgId?: string }): Promise<TestTenant> {
  const suffix = randomUUID().slice(0, 8);
  const clerkOrgId = overrides?.clerkOrgId ?? `org_test_${suffix}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenant (clerk_org_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [clerkOrgId, `Test Business ${suffix}`, `test-${suffix}`],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('createTestTenant: insert returned no row');
  }
  return { id: row.id, clerkOrgId };
}

export function createTestMembership(
  tenantId: string,
  clerkUserId: string,
  role: 'owner' | 'frontdesk' = 'frontdesk',
): Promise<string> {
  return withTenantTransaction(tenantId, clerkUserId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO membership (tenant_id, clerk_user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, clerkUserId, role],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createTestMembership: insert returned no row');
    }
    return row.id;
  });
}
