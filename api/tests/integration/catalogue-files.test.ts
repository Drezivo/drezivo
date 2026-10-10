import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  fileObjectId,
  replaceClothingImagesRequest,
  uploadAuthorizationRequest,
  type FileObjectId,
  type PermissionCode,
} from '@drezivo/contracts';

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
process.env.FILE_OBJECT_CLEANUP_ENABLED = 'true';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const PNG_PREFIX = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_PREFIX = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const SHA_A = Buffer.alloc(32, 1).toString('base64');
const SHA_B = Buffer.alloc(32, 2).toString('base64');

class FakeStorage {
  readonly authorized: Array<{
    storageKey: string;
    contentType: string;
    expiresInSeconds: number;
  }> = [];
  readonly inspected: string[] = [];
  readonly authorizedReads: Array<{
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }> = [];
  readonly objects = new Map<
    string,
    {
      contentType: string;
      byteSize: number;
      sha256: string | null;
      versionId: string | null;
      prefix: Uint8Array;
    }
  >();
  failInspection = false;

  authorizeUpload(input: { storageKey: string; contentType: string; expiresInSeconds: number }) {
    this.authorized.push(input);
    return Promise.resolve({
      uploadUrl: `https://uploads.example.test/${encodeURIComponent(input.storageKey)}`,
      requiredHeaders: {
        'Content-Type': input.contentType,
        'If-None-Match': '*',
      },
      expiresAt: new Date('2026-09-21T00:00:00.000Z'),
    });
  }

  authorizeRead(input: {
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }) {
    this.authorizedReads.push(input);
    return Promise.resolve({
      readUrl: `https://reads.example.test/${encodeURIComponent(input.storageKey)}?version=${encodeURIComponent(input.versionId ?? '')}`,
      expiresAt: new Date('2026-09-21T00:05:00.000Z'),
    });
  }

  inspectUploadedObject(storageKey: string) {
    this.inspected.push(storageKey);
    if (this.failInspection) {
      return Promise.reject(new Error('provider unavailable'));
    }
    return Promise.resolve(this.objects.get(storageKey) ?? null);
  }
}

describe('CLT-022 clothing file attachment flow', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { config } = await import('../../src/config/index.js');
  const { authorizeUpload, finalizeUpload } =
    await import('../../src/modules/files/files.service.js');
  const { getDefaultMeasurementGuide, replaceClothingImages } =
    await import('../../src/modules/catalogue/catalogue.service.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

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

  it('returns a short-lived signed image URL for the accepted default measurement guide', async () => {
    const seed = await seedTenant('org_clt022_guide_view', 'user_clt022_guide_view');
    const storage = new FakeStorage();
    const seeded = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const file = await client.query<{ id: string; storage_key: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'measurement_guide', $2, 'guide-version-1', $3, 'image/png', 512,
                 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id, storage_key`,
        [seed.tenantId, `tenant-files/${seed.tenantId}/guide-view/source`, SHA_A],
      );
      const fileRow = requireRow(file.rows, 'guide file');
      const guide = await client.query<{ id: string }>(
        `INSERT INTO measurement_guide (tenant_id, file_id, name, status, is_default)
         VALUES ($1, $2, 'Standard Size Guide', 'active', true)
         RETURNING id`,
        [seed.tenantId, fileRow.id],
      );
      return {
        fileId: fileRow.id,
        storageKey: fileRow.storage_key,
        guideId: requireRow(guide.rows, 'guide').id,
      };
    });

    const result = await getDefaultMeasurementGuide(seed.catalogueContext, storage);

    expect(result.guide?.id).toBe(seeded.guideId);
    expect(result.guide?.file_id).toBe(seeded.fileId);
    expect(result.guide?.name).toBe('Standard Size Guide');
    expect(result.guide?.image_url).toContain('https://reads.example.test/');
    expect(storage.authorizedReads).toEqual([
      {
        storageKey: seeded.storageKey,
        versionId: 'guide-version-1',
        expiresInSeconds: 300,
      },
    ]);
  });

  it('authorizes a bounded private catalogue upload and accepts only the verified frozen object', async () => {
    const seed = await seedTenant('org_clt022_accept', 'user_clt022_accept');
    const storage = new FakeStorage();
    const request = uploadAuthorizationRequest.parse({
      purpose: 'catalogue_image',
      content_type: 'image/png',
      byte_size: 512,
      sha256: SHA_A,
    });

    const authorization = await authorizeUpload(
      {
        ...seed.fileContext,
        requestId: 'req-clt022-authorize',
        idempotencyKey: 'clt022-authorize-1',
        request,
      },
      storage,
    );
    expect(authorization.status).toBe(201);
    if (!authorization.body.success) throw new Error('Expected upload authorization success.');
    expect(authorization.body.data.required_headers).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    });
    expect(JSON.stringify(authorization.body)).not.toContain(
      process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    );
    expect(JSON.stringify(authorization.body)).not.toContain(
      process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
    );

    const fileId = authorization.body.data.file_id;
    const pending = await readFile(seed.tenantId, seed.principalId, fileId);
    expect(storage.authorized[0]?.storageKey).toBe(
      `tenant-files/${seed.tenantId}/catalogue-images/${fileId}/source`,
    );
    expect(pending).toMatchObject({
      purpose: 'catalogue_image',
      mime_type: 'image/png',
      byte_size: 512,
      lifecycle_status: 'pending_upload',
      is_private: true,
      sha256: SHA_A,
      frozen_at: null,
    });
    expect(storage.authorized).toHaveLength(1);

    storage.objects.set(pending.storage_key, {
      contentType: 'image/png',
      byteSize: 512,
      sha256: SHA_A,
      versionId: 'version-accepted-1',
      prefix: PNG_PREFIX,
    });

    const finalized = await finalizeUpload(
      {
        ...seed.fileContext,
        fileId,
        requestId: 'req-clt022-finalize',
        idempotencyKey: 'testidem06',
      },
      storage,
    );
    expect(finalized.status).toBe(200);
    if (!finalized.body.success) throw new Error('Expected upload finalization success.');
    expect(finalized.body.data.file).toMatchObject({
      file_id: fileId,
      purpose: 'catalogue_image',
      lifecycle_status: 'accepted',
      content_type: 'image/png',
      byte_size: 512,
      sha256: SHA_A,
    });
    expect(finalized.body.data.file.frozen_at).toEqual(expect.any(String));

    const accepted = await readFile(seed.tenantId, seed.principalId, fileId);
    expect(accepted.lifecycle_status).toBe('accepted');
    expect(accepted.version_id).toBe('version-accepted-1');
    expect(accepted.frozen_at).toBeInstanceOf(Date);
  });

  it('allows reservation/payment staff to upload a private payment receipt without granting catalogue file access', async () => {
    const seed = await seedTenant('org_clt022_receipt', 'user_clt022_receipt');
    const storage = new FakeStorage();
    const paymentFileContext = {
      ...seed.fileContext,
      permissionCodes: ['reservations.manage', 'payments.manage'] as PermissionCode[],
    };
    const authorization = await authorizeUpload(
      {
        ...paymentFileContext,
        requestId: 'req-clt022-receipt-authorize',
        idempotencyKey: 'clt022-receipt-authorize',
        request: uploadAuthorizationRequest.parse({
          purpose: 'payment_receipt',
          content_type: 'application/pdf',
          byte_size: 512,
          sha256: SHA_A,
        }),
      },
      storage,
    );
    expect(authorization.status).toBe(201);
    if (!authorization.body.success)
      throw new Error('Expected payment receipt authorization success.');

    const fileId = authorization.body.data.file_id;
    const pending = await readFile(seed.tenantId, seed.principalId, fileId);
    expect(storage.authorized[0]?.storageKey).toBe(
      `tenant-files/${seed.tenantId}/payment-receipts/${fileId}/source`,
    );
    storage.objects.set(pending.storage_key, {
      contentType: 'application/pdf',
      byteSize: 512,
      sha256: SHA_A,
      versionId: 'receipt-version-1',
      prefix: PDF_PREFIX,
    });

    const finalized = await finalizeUpload(
      {
        ...paymentFileContext,
        fileId,
        requestId: 'req-clt022-receipt-finalize',
        idempotencyKey: 'receipt-finish',
      },
      storage,
    );
    expect(finalized.status).toBe(200);
    if (!finalized.body.success) throw new Error('Expected payment receipt finalization success.');
    expect(finalized.body.data.file).toMatchObject({
      file_id: fileId,
      purpose: 'payment_receipt',
      content_type: 'application/pdf',
      lifecycle_status: 'accepted',
    });

    await expect(
      authorizeUpload(
        {
          ...paymentFileContext,
          requestId: 'req-clt022-receipt-catalogue-denied',
          idempotencyKey: 'receipt-denied',
          request: uploadAuthorizationRequest.parse({
            purpose: 'catalogue_image',
            content_type: 'image/png',
            byte_size: 512,
            sha256: SHA_B,
          }),
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects mismatched uploaded bytes and never marks provider failures as accepted', async () => {
    const seed = await seedTenant('org_clt022_invalid', 'user_clt022_invalid');
    const storage = new FakeStorage();
    const first = await authorizeCatalogueFile(
      seed,
      storage,
      'clt022-invalid-authorize',
      SHA_A,
      300,
    );
    const firstRow = await readFile(seed.tenantId, seed.principalId, first);
    storage.objects.set(firstRow.storage_key, {
      contentType: 'image/png',
      byteSize: 300,
      sha256: SHA_B,
      versionId: 'version-invalid',
      prefix: PNG_PREFIX,
    });

    const rejected = await finalizeUpload(
      {
        ...seed.fileContext,
        fileId: first,
        requestId: 'req-clt022-invalid-finalize',
        idempotencyKey: 'testidem07',
      },
      storage,
    );
    expect(rejected.status).toBe(422);
    expectFailure(rejected.body, 'VALIDATION_FAILED');
    expect((await readFile(seed.tenantId, seed.principalId, first)).lifecycle_status).toBe(
      'rejected',
    );

    const second = await authorizeCatalogueFile(
      seed,
      storage,
      'clt022-provider-authorize',
      SHA_A,
      320,
    );
    storage.failInspection = true;
    await expect(
      finalizeUpload(
        {
          ...seed.fileContext,
          fileId: second,
          requestId: 'req-clt022-provider-finalize',
          idempotencyKey: 'clt022-provider-finalize',
        },
        storage,
      ),
    ).rejects.toThrow('provider unavailable');
    expect((await readFile(seed.tenantId, seed.principalId, second)).lifecycle_status).toBe(
      'pending_upload',
    );
  });

  it('finalizes an existing upload by its stored legacy object key', async () => {
    const seed = await seedTenant('org_clt022_legacy_key', 'user_clt022_legacy_key');
    const storage = new FakeStorage();
    const fileId = fileObjectId.parse('00000000-0000-4000-8000-000000000123');
    const legacyStorageKey = `tenant-files/${seed.tenantId}/${fileId}/source`;

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `INSERT INTO file_object
           (id, tenant_id, purpose, storage_key, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at)
         VALUES ($1, $2, 'catalogue_image', $3, $4, 'image/png', 512,
                 'pending_upload', true, now() + interval '10 minutes')`,
        [fileId, seed.tenantId, legacyStorageKey, SHA_A],
      ),
    );
    storage.objects.set(legacyStorageKey, {
      contentType: 'image/png',
      byteSize: 512,
      sha256: SHA_A,
      versionId: 'legacy-version-1',
      prefix: PNG_PREFIX,
    });

    const finalized = await finalizeUpload(
      {
        ...seed.fileContext,
        fileId,
        requestId: 'req-clt022-legacy-finalize',
        idempotencyKey: 'legacy-test',
      },
      storage,
    );

    expect(finalized.status).toBe(200);
    expect(storage.inspected).toEqual([legacyStorageKey]);
    expect((await readFile(seed.tenantId, seed.principalId, fileId)).version_id).toBe(
      'legacy-version-1',
    );
  });

  it('conceals foreign uploads before storage inspection', async () => {
    const own = await seedTenant('org_clt022_owner', 'user_clt022_owner');
    const foreign = await seedTenant('org_clt022_foreign', 'user_clt022_foreign');
    const storage = new FakeStorage();
    const foreignFileId = await authorizeCatalogueFile(
      foreign,
      storage,
      'clt022-foreign-authorize',
      SHA_A,
      256,
    );
    storage.inspected.length = 0;

    await expect(
      finalizeUpload(
        {
          ...own.fileContext,
          fileId: foreignFileId,
          requestId: 'req-clt022-foreign-finalize',
          idempotencyKey: 'testidem08',
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(storage.inspected).toHaveLength(0);
  });

  it('enforces clothing image type/size policy and verifies uploaded metadata before acceptance', async () => {
    const seed = await seedTenant('org_clt022_policy', 'user_clt022_policy');
    const storage = new FakeStorage();

    await expect(
      authorizeUpload(
        {
          ...seed.fileContext,
          requestId: 'req-clt022-pdf',
          idempotencyKey: 'clt022-pdf',
          request: uploadAuthorizationRequest.parse({
            purpose: 'catalogue_image',
            content_type: 'application/pdf',
            byte_size: 512,
            sha256: SHA_A,
          }),
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(storage.authorized).toHaveLength(0);

    const wrongType = await authorizeCatalogueFile(seed, storage, 'clt022-wrong-type', SHA_A, 400);
    const wrongTypeRow = await readFile(seed.tenantId, seed.principalId, wrongType);
    storage.objects.set(wrongTypeRow.storage_key, {
      contentType: 'image/jpeg',
      byteSize: 400,
      sha256: SHA_A,
      versionId: 'wrong-type-version',
      prefix: Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0]),
    });
    const typeResult = await finalizeUpload(
      {
        ...seed.fileContext,
        fileId: wrongType,
        requestId: 'req-clt022-wrong-type-finalize',
        idempotencyKey: 'clt022-wrong-type-finalize',
      },
      storage,
    );
    expect(typeResult.status).toBe(422);
    expect((await readFile(seed.tenantId, seed.principalId, wrongType)).lifecycle_status).toBe(
      'rejected',
    );

    const wrongSize = await authorizeCatalogueFile(seed, storage, 'clt022-wrong-size', SHA_B, 401);
    const wrongSizeRow = await readFile(seed.tenantId, seed.principalId, wrongSize);
    storage.objects.set(wrongSizeRow.storage_key, {
      contentType: 'image/png',
      byteSize: 402,
      sha256: SHA_B,
      versionId: 'wrong-size-version',
      prefix: PNG_PREFIX,
    });
    const sizeResult = await finalizeUpload(
      {
        ...seed.fileContext,
        fileId: wrongSize,
        requestId: 'req-clt022-wrong-size-finalize',
        idempotencyKey: 'testidem09',
      },
      storage,
    );
    expect(sizeResult.status).toBe(422);
    expect((await readFile(seed.tenantId, seed.principalId, wrongSize)).lifecycle_status).toBe(
      'rejected',
    );
  });

  it('checks assets.manage before upload authorization or photo mutation', async () => {
    const seed = await seedTenant('org_clt022_permission', 'user_clt022_permission');
    const storage = new FakeStorage();
    const deniedFileContext = { ...seed.fileContext, permissionCodes: [] as PermissionCode[] };

    await expect(
      authorizeUpload(
        {
          ...deniedFileContext,
          requestId: 'req-clt022-denied-upload',
          idempotencyKey: 'clt022-denied-upload',
          request: uploadAuthorizationRequest.parse({
            purpose: 'catalogue_image',
            content_type: 'image/png',
            byte_size: 512,
            sha256: SHA_A,
          }),
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(storage.authorized).toHaveLength(0);

    const productId = await seedProduct(seed, 'IMG-DENIED');
    const accepted = await seedAcceptedImage(seed, 'denied-image', SHA_A);
    await expect(
      replaceClothingImages({
        ...seed.catalogueContext,
        permissionCodes: [] as PermissionCode[],
        productId,
        requestId: 'req-clt022-denied-images',
        idempotencyKey: 'clt022-denied-images',
        request: replaceClothingImagesRequest.parse({ file_ids: [accepted] }),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await readProductImages(seed, productId)).toEqual([]);
  });

  it('replaces ordered product photos idempotently and treats index zero as the cover image', async () => {
    const seed = await seedTenant('org_clt022_images', 'user_clt022_images');
    const productId = await seedProduct(seed, 'IMG-001');
    const fileA = await seedAcceptedImage(seed, 'image-a', SHA_A);
    const fileB = await seedAcceptedImage(seed, 'image-b', SHA_B);
    const requestBody = replaceClothingImagesRequest.parse({ file_ids: [fileB, fileA] });
    const command = {
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-images',
      idempotencyKey: 'clt022-images-replace',
      request: requestBody,
    };

    const first = await replaceClothingImages(command);
    const replay = await replaceClothingImages(command);
    expect(first.status).toBe(200);
    expect(replay).toEqual(first);
    if (!first.body.success) throw new Error('Expected image replacement success.');
    expect(first.body.data.cover_file_id).toBe(fileB);
    expect(first.body.data.images.map((image) => [image.file_id, image.display_order])).toEqual([
      [fileB, 0],
      [fileA, 1],
    ]);
    expect(await readProductImages(seed, productId)).toEqual([
      { file_id: fileB, display_order: 0 },
      { file_id: fileA, display_order: 1 },
    ]);

    await expect(
      replaceClothingImages({
        ...command,
        requestId: 'req-clt022-images-changed',
        request: replaceClothingImagesRequest.parse({ file_ids: [fileA, fileB] }),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await readProductImages(seed, productId)).toEqual([
      { file_id: fileB, display_order: 0 },
      { file_id: fileA, display_order: 1 },
    ]);
  });

  it('queues only displaced clothing images and does not queue an image retained in the new set', async () => {
    const seed = await seedTenant('org_clt022_cleanup', 'user_clt022_cleanup');
    const productId = await seedProduct(seed, 'IMG-CLEANUP');
    const retained = await seedAcceptedImage(seed, 'cleanup-retained', SHA_A);
    const displaced = await seedAcceptedImage(seed, 'cleanup-displaced', SHA_B);
    const replacement = await seedAcceptedImage(seed, 'cleanup-replacement', SHA_A);

    const initial = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-cleanup-initial',
      idempotencyKey: 'clt022-cleanup-initial',
      request: replaceClothingImagesRequest.parse({ file_ids: [retained, displaced] }),
    });
    expect(initial.status).toBe(200);

    const replaced = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-cleanup-replace',
      idempotencyKey: 'clt022-cleanup-replace',
      request: replaceClothingImagesRequest.parse({ file_ids: [replacement, retained] }),
    });
    expect(replaced.status).toBe(200);
    expect(await readProductImages(seed, productId)).toEqual([
      { file_id: replacement, display_order: 0 },
      { file_id: retained, display_order: 1 },
    ]);

    const cleanupCandidates = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const result = await client.query<{ payload: { file_id: string } }>(
          `SELECT payload FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'
          ORDER BY dedupe_key`,
          [seed.tenantId],
        );
        return result.rows.map((row) => row.payload.file_id);
      },
    );
    expect(cleanupCandidates).toEqual([displaced]);
  });

  it('keeps the old clothing image set when the cleanup producer gate is off', async () => {
    const seed = await seedTenant('org_clt022_cleanup_gate', 'user_clt022_cleanup_gate');
    const productId = await seedProduct(seed, 'IMG-CLEANUP-GATE');
    const previous = await seedAcceptedImage(seed, 'cleanup-gate-previous', SHA_A);
    const replacement = await seedAcceptedImage(seed, 'cleanup-gate-replacement', SHA_B);
    const initial = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-cleanup-gate-initial',
      idempotencyKey: 'clt022-cleanup-gate-initial',
      request: replaceClothingImagesRequest.parse({ file_ids: [previous] }),
    });
    expect(initial.status).toBe(200);

    config.FILE_OBJECT_CLEANUP_ENABLED = false;
    try {
      await expect(
        replaceClothingImages({
          ...seed.catalogueContext,
          productId,
          requestId: 'req-clt022-cleanup-gate-replace',
          idempotencyKey: 'clt022-cleanup-gate-replace',
          request: replaceClothingImagesRequest.parse({ file_ids: [replacement] }),
        }),
      ).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    } finally {
      config.FILE_OBJECT_CLEANUP_ENABLED = true;
    }

    expect(await readProductImages(seed, productId)).toEqual([
      { file_id: previous, display_order: 0 },
    ]);
    const cleanupCandidates = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'`,
          [seed.tenantId],
        );
        return Number(result.rows[0]?.count ?? 0);
      },
    );
    expect(cleanupCandidates).toBe(0);
  });

  it('rejects duplicate, pending, and foreign photo references without altering the existing photo set', async () => {
    const seed = await seedTenant('org_clt022_attachment', 'user_clt022_attachment');
    const foreign = await seedTenant(
      'org_clt022_attachment_foreign',
      'user_clt022_attachment_foreign',
    );
    const productId = await seedProduct(seed, 'IMG-002');
    const accepted = await seedAcceptedImage(seed, 'accepted-image', SHA_A);
    const pending = await seedPendingImage(seed, 'pending-image', SHA_B);
    const foreignAccepted = await seedAcceptedImage(foreign, 'foreign-image', SHA_B);

    const initial = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-initial',
      idempotencyKey: 'clt022-initial',
      request: replaceClothingImagesRequest.parse({ file_ids: [accepted] }),
    });
    expect(initial.status).toBe(200);

    await expect(
      replaceClothingImages({
        ...seed.catalogueContext,
        productId,
        requestId: 'req-clt022-duplicate',
        idempotencyKey: 'clt022-duplicate',
        request: { file_ids: [accepted, accepted] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const pendingResult = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-pending',
      idempotencyKey: 'testidem10',
      request: replaceClothingImagesRequest.parse({ file_ids: [pending] }),
    });
    expect(pendingResult.status).toBe(422);
    expectFailure(pendingResult.body, 'VALIDATION_FAILED');

    const foreignResult = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-foreign-image',
      idempotencyKey: 'clt022-foreign-image',
      request: replaceClothingImagesRequest.parse({ file_ids: [foreignAccepted] }),
    });
    expect(foreignResult.status).toBe(404);
    expectFailure(foreignResult.body, 'NOT_FOUND');

    expect(await readProductImages(seed, productId)).toEqual([
      { file_id: accepted, display_order: 0 },
    ]);
  });

  it('enforces the five-photo database guard and keeps the ordered replacement path bounded', async () => {
    const seed = await seedTenant('org_clt022_photo_limit', 'user_clt022_photo_limit');
    const productId = await seedProduct(seed, 'IMG-005');
    const fileIds = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        seedAcceptedImage(seed, `photo-limit-${index + 1}`, index % 2 === 0 ? SHA_A : SHA_B),
      ),
    );

    await expect(
      replaceClothingImages({
        ...seed.catalogueContext,
        productId,
        requestId: 'req-clt022-photo-limit-invalid',
        idempotencyKey: 'clt022-photo-limit-invalid',
        request: { file_ids: fileIds },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await readProductImages(seed, productId)).toHaveLength(0);

    const result = await replaceClothingImages({
      ...seed.catalogueContext,
      productId,
      requestId: 'req-clt022-photo-limit',
      idempotencyKey: 'clt022-photo-limit',
      request: replaceClothingImagesRequest.parse({ file_ids: fileIds.slice(0, 5) }),
    });
    expect(result.status).toBe(200);
    expect(await readProductImages(seed, productId)).toHaveLength(5);

    await expect(
      withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
        client.query(
          `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
           VALUES ($1, $2, $3, 5)`,
          [seed.tenantId, productId, fileIds[5]],
        ),
      ),
    ).rejects.toMatchObject({ constraint: 'product_image_max_five_per_product' });
    expect(await readProductImages(seed, productId)).toHaveLength(5);

    const concurrentProductId = await seedProduct(seed, 'IMG-006');
    await replaceClothingImages({
      ...seed.catalogueContext,
      productId: concurrentProductId,
      requestId: 'req-clt022-photo-limit-concurrent-seed',
      idempotencyKey: 'clt022-photo-limit-concurrent-seed',
      request: replaceClothingImagesRequest.parse({ file_ids: fileIds.slice(0, 4) }),
    });
    const concurrentResults = await Promise.allSettled(
      fileIds.slice(4, 6).map((fileId, index) => {
        const displayOrder = index + 4;
        return withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
          client.query(
            `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
             VALUES ($1, $2, $3, $4)`,
            [seed.tenantId, concurrentProductId, fileId, displayOrder],
          ),
        );
      }),
    );
    expect(concurrentResults.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const concurrentFailure = concurrentResults.find((outcome) => outcome.status === 'rejected');
    expect(concurrentFailure).toMatchObject({
      status: 'rejected',
      reason: { constraint: 'product_image_max_five_per_product' },
    });
    expect(await readProductImages(seed, concurrentProductId)).toHaveLength(5);
  });

  async function seedTenant(clerkOrgId: string, principalId: string) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const branchId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const id = requireRow(branch.rows, 'branch').id;
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, id, membershipId, JSON.stringify(['assets.manage'])],
      );
      return id;
    });
    await createSubscription(tenant.id, principalId);
    const permissionCodes = ['assets.manage'] as PermissionCode[];
    return {
      tenantId: tenant.id,
      branchId,
      membershipId,
      principalId,
      fileContext: {
        tenantId: tenant.id,
        membershipId,
        principalId,
        permissionCodes,
        effectiveTenantStatus: 'active' as const,
      },
      catalogueContext: {
        tenantId: tenant.id,
        branchId,
        membershipId,
        principalId,
        permissionCodes,
        effectiveTenantStatus: 'active' as const,
      },
    };
  }

  async function createSubscription(tenantId: string, principalId: string) {
    await withTenantTransaction(tenantId, principalId, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true`,
      );
      const planId = requireRow(plan.rows, 'starter plan').id;
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenantId, planId],
      );
    });
  }

  async function seedProduct(
    seed: Awaited<ReturnType<typeof seedTenant>>,
    code: string,
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, $2, 'active', 10)
         RETURNING id`,
        [seed.tenantId, `Category ${code}`],
      );
      const categoryId = requireRow(category.rows, 'category').id;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id`,
        [seed.tenantId, categoryId, code, `Product ${code}`],
      );
      return requireRow(product.rows, 'product').id;
    });
  }

  async function seedAcceptedImage(
    seed: Awaited<ReturnType<typeof seedTenant>>,
    label: string,
    sha256: string,
  ): Promise<FileObjectId> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', $2, $3, $4, 'image/png', 512,
                 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [seed.tenantId, `tenant-files/${seed.tenantId}/${label}`, `version-${label}`, sha256],
      );
      return fileObjectId.parse(requireRow(result.rows, 'accepted file').id);
    });
  }

  async function seedPendingImage(
    seed: Awaited<ReturnType<typeof seedTenant>>,
    label: string,
    sha256: string,
  ): Promise<FileObjectId> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at)
         VALUES ($1, 'catalogue_image', $2, $3, 'image/png', 512,
                 'pending_upload', true, now() + interval '10 minutes')
         RETURNING id`,
        [seed.tenantId, `tenant-files/${seed.tenantId}/${label}`, sha256],
      );
      return fileObjectId.parse(requireRow(result.rows, 'pending file').id);
    });
  }

  async function authorizeCatalogueFile(
    seed: Awaited<ReturnType<typeof seedTenant>>,
    storage: FakeStorage,
    intentKey: string,
    sha256: string,
    byteSize: number,
  ): Promise<FileObjectId> {
    const response = await authorizeUpload(
      {
        ...seed.fileContext,
        requestId: `req-${intentKey}`,
        idempotencyKey: intentKey,
        request: uploadAuthorizationRequest.parse({
          purpose: 'catalogue_image',
          content_type: 'image/png',
          byte_size: byteSize,
          sha256,
        }),
      },
      storage,
    );
    if (!response.body.success) throw new Error('Expected upload authorization success.');
    return response.body.data.file_id;
  }

  async function readFile(tenantId: string, principalId: string, fileId: string) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const result = await client.query<{
        storage_key: string;
        purpose: string;
        mime_type: string;
        byte_size: number;
        lifecycle_status: string;
        is_private: boolean;
        sha256: string | null;
        version_id: string | null;
        frozen_at: Date | null;
      }>(
        `SELECT storage_key, purpose, mime_type, byte_size, lifecycle_status, is_private,
                sha256, version_id, frozen_at
           FROM file_object
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, fileId],
      );
      return requireRow(result.rows, 'file');
    });
  }

  async function readProductImages(
    seed: Awaited<ReturnType<typeof seedTenant>>,
    productId: string,
  ): Promise<Array<{ file_id: string; display_order: number }>> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ file_id: string; display_order: number }>(
        `SELECT file_id, display_order
           FROM product_image
          WHERE tenant_id = $1 AND product_id = $2
          ORDER BY display_order ASC`,
        [seed.tenantId, productId],
      );
      return result.rows;
    });
  }

  function expectFailure(body: { success: boolean; error?: { code: string } }, code: string): void {
    expect(body.success).toBe(false);
    if (body.success || !body.error) throw new Error('Expected a failure envelope.');
    expect(body.error.code).toBe(code);
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Missing ${label}.`);
    return row;
  }
});
