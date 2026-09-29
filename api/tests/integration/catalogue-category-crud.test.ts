import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

import '../../src/config/load-env.js';
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
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-070 catalogue category CRUD', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    createCatalogueCategory,
    getCatalogueCategories,
    removeCatalogueCategory,
    updateCatalogueCategory,
  } = await import('../../src/modules/catalogue/catalogue.service.js');
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

  it('creates and edits a tenant category with idempotent command responses', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt070_create_edit' });
    const context = commandContext(tenant.id, 'user_clt070_create_edit');

    const created = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-create',
      idempotencyKey: 'clt070-create',
      request: { name: 'Cocktail Dresses', display_order: 20 },
    });
    const replay = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-create-replay',
      idempotencyKey: 'clt070-create',
      request: { name: 'Cocktail Dresses', display_order: 20 },
    });

    expect(created.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    if (!created.body.success) throw new Error('Expected category creation success.');

    const updated = await updateCatalogueCategory({
      ...context,
      requestId: 'req-clt070-update',
      idempotencyKey: 'clt070-update',
      categoryId: created.body.data.id,
      request: { name: 'Cocktail & Party Dresses', display_order: 5 },
    });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      success: true,
      data: {
        id: created.body.data.id,
        name: 'Cocktail & Party Dresses',
        display_order: 5,
        status: 'active',
      },
    });

    const categories = await getCatalogueCategories(context);
    expect(categories.items).toEqual([
      expect.objectContaining({
        id: created.body.data.id,
        name: 'Cocktail & Party Dresses',
        display_order: 5,
      }),
    ]);
  });

  it('rejects a duplicate category name without leaking a database error', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt070_duplicate' });
    const context = commandContext(tenant.id, 'user_clt070_duplicate');

    const first = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-duplicate-a',
      idempotencyKey: 'testtest88',
      request: { name: 'Gowns', display_order: 10 },
    });
    expect(first.status).toBe(201);

    const duplicate = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-duplicate-b',
      idempotencyKey: 'testtest99',
      request: { name: '  gowns  ', display_order: 20 },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      success: false,
      error: { code: 'STATE_CONFLICT' },
    });
    expect(JSON.stringify(duplicate.body)).not.toMatch(/constraint|category_tenant_name_ci_key/i);
  });

  it('hard-deletes an unused category', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt070_delete_unused' });
    const context = commandContext(tenant.id, 'user_clt070_delete_unused');
    const created = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-unused-create',
      idempotencyKey: 'clt070-unused-create',
      request: { name: 'Temporary Category', display_order: 99 },
    });
    if (!created.body.success) throw new Error('Expected category creation success.');

    const removed = await removeCatalogueCategory({
      ...context,
      requestId: 'req-clt070-unused-remove',
      idempotencyKey: 'clt070-unused-remove',
      categoryId: created.body.data.id,
    });

    expect(removed).toMatchObject({
      status: 200,
      body: {
        success: true,
        data: { category_id: created.body.data.id, outcome: 'deleted' },
      },
    });
    expect((await getCatalogueCategories(context)).items).toEqual([]);
  });

  it('deactivates a referenced category and preserves the product reference', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt070_remove_referenced' });
    const context = commandContext(tenant.id, 'user_clt070_remove_referenced');
    const created = await createCatalogueCategory({
      ...context,
      requestId: 'req-clt070-ref-create',
      idempotencyKey: 'clt070-ref-create',
      request: { name: 'Formal Wear', display_order: 10 },
    });
    if (!created.body.success) throw new Error('Expected category creation success.');
    const categoryId = created.body.data.id;

    const productId = await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'CLT070-REF', 'Referenced Suit', '', 'draft')
         RETURNING id`,
        [tenant.id, categoryId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Expected referenced product.');
      return row.id;
    });

    const removed = await removeCatalogueCategory({
      ...context,
      requestId: 'req-clt070-ref-remove',
      idempotencyKey: 'clt070-ref-remove',
      categoryId,
    });

    expect(removed).toMatchObject({
      status: 200,
      body: {
        success: true,
        data: { category_id: categoryId, outcome: 'deactivated' },
      },
    });

    const preserved = await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      const result = await client.query<{ category_id: string; category_status: string }>(
        `SELECT p.category_id, c.status AS category_status
           FROM product p
           JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
          WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenant.id, productId],
      );
      return result.rows[0];
    });
    expect(preserved).toEqual({
      category_id: categoryId,
      category_status: 'inactive',
    });
  });
});

function commandContext(tenantId: string, principalId: string) {
  return {
    tenantId,
    branchId: '00000000-0000-4000-8000-000000000001',
    membershipId: '00000000-0000-4000-8000-0000000000aa',
    principalId,
    permissionCodes: ['assets.manage'] as PermissionCode[],
    effectiveTenantStatus: 'active' as const,
  };
}
