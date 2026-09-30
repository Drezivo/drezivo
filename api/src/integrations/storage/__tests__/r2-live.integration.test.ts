import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { config } from '../../../config/index.js';
import { S3CompatibleObjectStorage } from '../s3-compatible-object-storage.js';

const liveDescribe = process.env.OBJECT_STORAGE_LIVE_TESTS === 'true' ? describe : describe.skip;
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

liveDescribe('live Cloudflare R2 object storage', () => {
  it('uploads to a confirmed test bucket, prevents overwrite, verifies bytes, and signs private reads', async () => {
    assertLiveTestConfiguration();
    const storage = new S3CompatibleObjectStorage(config);
    const storageKey = `tenant-files/r2-live-test/${randomUUID()}/image.png`;
    const expectedSha256 = createHash('sha256').update(pngBytes).digest('base64');

    try {
      const upload = await storage.authorizeUpload({
        storageKey,
        contentType: 'image/png',
        expiresInSeconds: 600,
      });
      expect(upload.requiredHeaders).toEqual({
        'Content-Type': 'image/png',
        'If-None-Match': '*',
      });

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
        versionId: null,
      });
      expect(inspected?.prefix).toEqual(pngBytes.slice(0, 16));

      const read = await storage.authorizeRead({ storageKey, expiresInSeconds: 300 });
      const readResponse = await safeFetch(read.readUrl, { method: 'GET' });
      expect(readResponse.ok).toBe(true);
      const receivedBytes = new Uint8Array(await readResponse.arrayBuffer());
      expect(createHash('sha256').update(receivedBytes).digest('base64')).toBe(expectedSha256);

      const unsignedReadUrl = new URL(read.readUrl);
      unsignedReadUrl.search = '';
      const anonymousRead = await safeFetch(unsignedReadUrl.toString(), { method: 'GET' });
      expect(anonymousRead.ok).toBe(false);
    } finally {
      // Some deliberately narrow test credentials permit PUT/GET but not DELETE. The live test
      // still proves the application path; test-bucket lifecycle cleanup handles any leftover
      // r2-live-test objects when delete permission is intentionally absent.
      await storage.deleteObject(storageKey).catch(() => undefined);
    }
  });

  it('allows the configured browser origin and does not reflect an unrelated origin', async () => {
    const allowedOrigin = process.env.OBJECT_STORAGE_LIVE_TEST_ALLOWED_ORIGIN;
    const deniedOrigin = process.env.OBJECT_STORAGE_LIVE_TEST_DENIED_ORIGIN;
    if (!allowedOrigin || !deniedOrigin) return;
    assertLiveTestConfiguration();

    const storage = new S3CompatibleObjectStorage(config);
    const storageKey = `tenant-files/r2-live-test/${randomUUID()}/cors.png`;
    const upload = await storage.authorizeUpload({
      storageKey,
      contentType: 'image/png',
      expiresInSeconds: 600,
    });

    const allowed = await safeFetch(upload.uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type,if-none-match',
      },
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(allowedOrigin);

    const denied = await safeFetch(upload.uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: deniedOrigin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type,if-none-match',
      },
    });
    expect(denied.headers.get('access-control-allow-origin')).not.toBe(deniedOrigin);
  });
});

function assertLiveTestConfiguration(): void {
  const bucketName = config.OBJECT_STORAGE_BUCKET_PRIVATE.toLowerCase();
  const endpoint = new URL(config.OBJECT_STORAGE_ENDPOINT);
  if (
    config.NODE_ENV !== 'test' ||
    !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
    config.OBJECT_STORAGE_REGION !== 'auto' ||
    config.OBJECT_STORAGE_FORCE_PATH_STYLE ||
    !bucketName.includes('test') ||
    bucketName.includes('prod') ||
    process.env.OBJECT_STORAGE_LIVE_TEST_BUCKET_CONFIRM !== config.OBJECT_STORAGE_BUCKET_PRIVATE
  ) {
    throw new Error('Live R2 tests require test mode, region auto, and an explicitly confirmed non-production test bucket.');
  }
}

async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error('Live R2 request failed; signed URL details were intentionally omitted.');
  }
}
