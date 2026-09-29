import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { config } from '../../../config/index.js';
import { S3CompatibleObjectStorage } from '../s3-compatible-object-storage.js';

const liveEnabled = process.env.OBJECT_STORAGE_LIVE_TESTS === 'true';
const liveDescribe = liveEnabled ? describe : describe.skip;
const liveMinioEnabled = process.env.OBJECT_STORAGE_LIVE_MINIO_TESTS === 'true';
const liveMinioDescribe = liveMinioEnabled ? describe : describe.skip;
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);
const additionalFixtures = [
  {
    name: 'jpeg',
    contentType: 'image/jpeg',
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]),
  },
  {
    name: 'webp',
    contentType: 'image/webp',
    bytes: Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x04, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
    ]),
  },
  {
    name: 'pdf',
    contentType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.7\nsynthetic fixture\n'),
  },
] as const;

liveDescribe('live Cloudflare R2 object storage', () => {
  it('uploads, prevents overwrite, verifies stored bytes, signs private reads, and enforces CORS', async () => {
    const { allowedOrigin, deniedOrigin } = assertLiveTestConfiguration();
    const storage = new S3CompatibleObjectStorage(config);
    const storageKey = `tenant-files/r2-live-test/${randomUUID()}/source`;
    const concurrentStorageKey = `tenant-files/r2-live-test/${randomUUID()}/source`;
    const extraUploads = additionalFixtures.map((fixture) => ({
      fixture,
      storageKey: `tenant-files/r2-live-test/${randomUUID()}/${fixture.name}`,
    }));
    const expectedSha256 = createHash('sha256').update(pngBytes).digest('base64');

    try {
      const upload = await storage.authorizeUpload({
        storageKey,
        contentType: 'image/png',
        expiresInSeconds: 600,
      });

      const allowedPreflight = await safeFetch(upload.uploadUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type,if-none-match',
        },
      });
      expect(allowedPreflight.ok).toBe(true);
      expect(allowedPreflight.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
      expect(
        parseHeaderList(allowedPreflight.headers.get('access-control-allow-methods')),
      ).toContain('put');
      expect(parseHeaderList(allowedPreflight.headers.get('access-control-allow-headers'))).toEqual(
        expect.arrayContaining(['content-type', 'if-none-match']),
      );

      const deniedPreflight = await safeFetch(upload.uploadUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: deniedOrigin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type,if-none-match',
        },
      });
      expect(deniedPreflight.headers.get('access-control-allow-origin')).not.toBe(deniedOrigin);

      const firstPut = await safeFetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: pngBytes,
      });
      expect(firstPut.status).toBe(200);

      const repeatedPut = await safeFetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: pngBytes,
      });
      expect(repeatedPut.ok).toBe(false);

      const inspected = await storage.inspectUploadedObject(storageKey, pngBytes.byteLength);
      expect(inspected).toMatchObject({
        contentType: 'image/png',
        byteSize: pngBytes.byteLength,
        sha256: expectedSha256,
        prefix: pngBytes.slice(0, 16),
      });

      const read = await storage.authorizeRead({ storageKey, expiresInSeconds: 300 });
      const readResponse = await safeFetch(read.readUrl, { method: 'GET' });
      expect(readResponse.ok).toBe(true);
      const receivedBytes = new Uint8Array(await readResponse.arrayBuffer());
      expect(createHash('sha256').update(receivedBytes).digest('base64')).toBe(expectedSha256);

      const unsignedReadUrl = new URL(read.readUrl);
      unsignedReadUrl.search = '';
      const anonymousRead = await safeFetch(unsignedReadUrl.toString(), { method: 'GET' });
      expect(anonymousRead.ok).toBe(false);

      const concurrentUpload = await storage.authorizeUpload({
        storageKey: concurrentStorageKey,
        contentType: 'image/png',
        expiresInSeconds: 600,
      });
      const concurrentPuts = await Promise.all([
        safeFetch(concurrentUpload.uploadUrl, {
          method: 'PUT',
          headers: concurrentUpload.requiredHeaders,
          body: pngBytes,
        }),
        safeFetch(concurrentUpload.uploadUrl, {
          method: 'PUT',
          headers: concurrentUpload.requiredHeaders,
          body: pngBytes,
        }),
      ]);
      expect(concurrentPuts.filter((response) => response.ok)).toHaveLength(1);
      expect(concurrentPuts.filter((response) => !response.ok)).toHaveLength(1);

      for (const { fixture, storageKey: fixtureKey } of extraUploads) {
        await uploadAndVerifyFixture(storage, fixtureKey, fixture);
      }
    } finally {
      await Promise.all(
        [storageKey, concurrentStorageKey, ...extraUploads.map(({ storageKey: key }) => key)].map(
          (key) => storage.deleteObject(key),
        ),
      );
    }
  });
});

liveMinioDescribe('live local MinIO object storage', () => {
  it('supports create-only upload, stored-byte inspection, and signed private reads', async () => {
    assertLiveMinioConfiguration();
    const storage = new S3CompatibleObjectStorage(config);
    const storageKey = `tenant-files/minio-live-test/${randomUUID()}/source`;
    const concurrentStorageKey = `tenant-files/minio-live-test/${randomUUID()}/source`;
    const extraUploads = additionalFixtures.map((fixture) => ({
      fixture,
      storageKey: `tenant-files/minio-live-test/${randomUUID()}/${fixture.name}`,
    }));
    const expectedSha256 = createHash('sha256').update(pngBytes).digest('base64');

    try {
      const upload = await storage.authorizeUpload({
        storageKey,
        contentType: 'image/png',
        expiresInSeconds: 600,
      });
      const firstPut = await safeFetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: pngBytes,
      });
      expect(firstPut.ok).toBe(true);

      const repeatedPut = await safeFetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.requiredHeaders,
        body: pngBytes,
      });
      expect(repeatedPut.ok).toBe(false);

      const inspected = await storage.inspectUploadedObject(storageKey, pngBytes.byteLength);
      expect(inspected).toMatchObject({
        contentType: 'image/png',
        byteSize: pngBytes.byteLength,
        sha256: expectedSha256,
        prefix: pngBytes.slice(0, 16),
      });

      const read = await storage.authorizeRead({ storageKey, expiresInSeconds: 300 });
      const response = await safeFetch(read.readUrl, { method: 'GET' });
      expect(response.ok).toBe(true);
      const receivedBytes = new Uint8Array(await response.arrayBuffer());
      expect(createHash('sha256').update(receivedBytes).digest('base64')).toBe(expectedSha256);

      const concurrentUpload = await storage.authorizeUpload({
        storageKey: concurrentStorageKey,
        contentType: 'image/png',
        expiresInSeconds: 600,
      });
      const concurrentPuts = await Promise.all([
        safeFetch(concurrentUpload.uploadUrl, {
          method: 'PUT',
          headers: concurrentUpload.requiredHeaders,
          body: pngBytes,
        }),
        safeFetch(concurrentUpload.uploadUrl, {
          method: 'PUT',
          headers: concurrentUpload.requiredHeaders,
          body: pngBytes,
        }),
      ]);
      expect(concurrentPuts.filter((put) => put.ok)).toHaveLength(1);
      expect(concurrentPuts.filter((put) => !put.ok)).toHaveLength(1);

      for (const { fixture, storageKey: fixtureKey } of extraUploads) {
        await uploadAndVerifyFixture(storage, fixtureKey, fixture);
      }
    } finally {
      await Promise.all(
        [storageKey, concurrentStorageKey, ...extraUploads.map(({ storageKey: key }) => key)].map(
          (key) => storage.deleteObject(key),
        ),
      );
    }
  });
});

function assertLiveTestConfiguration(): { allowedOrigin: string; deniedOrigin: string } {
  const bucketName = config.OBJECT_STORAGE_BUCKET_PRIVATE.toLowerCase();
  const endpoint = new URL(config.OBJECT_STORAGE_ENDPOINT);
  if (
    config.NODE_ENV !== 'test' ||
    !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
    config.OBJECT_STORAGE_REGION !== 'auto' ||
    config.OBJECT_STORAGE_FORCE_PATH_STYLE ||
    !bucketName.includes('test') ||
    bucketName.includes('prod') ||
    process.env.OBJECT_STORAGE_LIVE_TEST_BUCKET_CONFIRM !== config.OBJECT_STORAGE_BUCKET_PRIVATE ||
    config.OBJECT_STORAGE_ACCESS_KEY_ID === 'unit-test-key' ||
    config.OBJECT_STORAGE_SECRET_ACCESS_KEY === 'unit-test-key' ||
    config.OBJECT_STORAGE_ACCESS_KEY_ID === 'test' ||
    config.OBJECT_STORAGE_SECRET_ACCESS_KEY === 'test'
  ) {
    throw new Error(
      'Live R2 tests require test mode, R2 region auto, and a non-production test bucket.',
    );
  }

  const allowedOrigin = parseTestOrigin(process.env.OBJECT_STORAGE_LIVE_TEST_ALLOWED_ORIGIN);
  const deniedOrigin = parseTestOrigin(process.env.OBJECT_STORAGE_LIVE_TEST_DENIED_ORIGIN);
  if (allowedOrigin === deniedOrigin) {
    throw new Error('Live R2 tests require distinct allowed and denied CORS origins.');
  }
  return { allowedOrigin, deniedOrigin };
}

function assertLiveMinioConfiguration(): void {
  const endpoint = new URL(config.OBJECT_STORAGE_ENDPOINT);
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname);
  const bucketName = config.OBJECT_STORAGE_BUCKET_PRIVATE.toLowerCase();
  if (
    config.NODE_ENV !== 'test' ||
    endpoint.protocol !== 'http:' ||
    !isLoopback ||
    !config.OBJECT_STORAGE_FORCE_PATH_STYLE ||
    bucketName.includes('prod') ||
    process.env.OBJECT_STORAGE_LIVE_MINIO_BUCKET_CONFIRM !== config.OBJECT_STORAGE_BUCKET_PRIVATE ||
    config.OBJECT_STORAGE_ACCESS_KEY_ID === 'unit-test-key' ||
    config.OBJECT_STORAGE_SECRET_ACCESS_KEY === 'unit-test-key' ||
    config.OBJECT_STORAGE_ACCESS_KEY_ID === 'test' ||
    config.OBJECT_STORAGE_SECRET_ACCESS_KEY === 'test'
  ) {
    throw new Error(
      'Live MinIO tests require loopback, path-style, explicit non-production settings.',
    );
  }
}

function parseTestOrigin(value: string | undefined): string {
  if (!value) throw new Error('Live R2 tests require dedicated CORS test origins.');
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.origin !== value) {
    throw new Error('Live R2 CORS test origins must be HTTPS origins without paths.');
  }
  return origin.origin;
}

function parseHeaderList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error('Live R2 request failed; signed URL details were intentionally omitted.');
  }
}

async function uploadAndVerifyFixture(
  storage: S3CompatibleObjectStorage,
  storageKey: string,
  fixture: { contentType: string; bytes: Uint8Array },
): Promise<void> {
  const authorization = await storage.authorizeUpload({
    storageKey,
    contentType: fixture.contentType,
    expiresInSeconds: 600,
  });
  const upload = await safeFetch(authorization.uploadUrl, {
    method: 'PUT',
    headers: authorization.requiredHeaders,
    body: fixture.bytes,
  });
  expect(upload.ok).toBe(true);

  const inspected = await storage.inspectUploadedObject(storageKey, fixture.bytes.byteLength);
  expect(inspected).toMatchObject({
    contentType: fixture.contentType,
    byteSize: fixture.bytes.byteLength,
    sha256: createHash('sha256').update(fixture.bytes).digest('base64'),
  });
  expect(Array.from(inspected?.prefix ?? [])).toEqual(Array.from(fixture.bytes.slice(0, 16)));
}
