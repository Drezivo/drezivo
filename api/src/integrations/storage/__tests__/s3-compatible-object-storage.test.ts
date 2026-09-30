import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/index.js';
import { DependencyUnavailableError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';
import { S3CompatibleObjectStorage } from '../s3-compatible-object-storage.js';

const r2Config: Pick<
  Config,
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_REGION'
  | 'OBJECT_STORAGE_BUCKET_PRIVATE'
  | 'OBJECT_STORAGE_ACCESS_KEY_ID'
  | 'OBJECT_STORAGE_SECRET_ACCESS_KEY'
  | 'OBJECT_STORAGE_FORCE_PATH_STYLE'
> = {
  OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  OBJECT_STORAGE_REGION: 'auto',
  OBJECT_STORAGE_BUCKET_PRIVATE: 'private-files',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
  OBJECT_STORAGE_FORCE_PATH_STYLE: false,
};

describe('S3-compatible object storage', () => {
  it('signs a create-only R2 upload with the headers the browser must send', async () => {
    const storage = new S3CompatibleObjectStorage(r2Config);

    const authorization = await storage.authorizeUpload({
      storageKey: 'tenant-files/tenant-id/file-id/source',
      contentType: 'image/png',
      expiresInSeconds: 600,
    });
    const url = new URL(authorization.uploadUrl);
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders');

    expect(url.hostname).toBe('private-files.account.r2.cloudflarestorage.com');
    expect(signedHeaders?.split(';')).toEqual(['content-type', 'host', 'if-none-match']);
    expect(authorization.requiredHeaders).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    });
    expect(
      [...url.searchParams.keys()].some((parameter) => parameter.toLowerCase().includes('checksum')),
    ).toBe(false);
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
    expect(authorization.uploadUrl).not.toContain(r2Config.OBJECT_STORAGE_SECRET_ACCESS_KEY);
  });

  it('signs private R2 reads without a version query for new immutable-key objects', async () => {
    const storage = new S3CompatibleObjectStorage(r2Config);

    const authorization = await storage.authorizeRead({
      storageKey: 'tenant-files/tenant-id/file-id/source',
      expiresInSeconds: 300,
    });
    const url = new URL(authorization.readUrl);

    expect(url.hostname).toBe('private-files.account.r2.cloudflarestorage.com');
    expect(url.searchParams.has('versionId')).toBe(false);
  });

  it('fails closed rather than ignoring a legacy version identifier on R2', async () => {
    const storage = new S3CompatibleObjectStorage(r2Config);

    await expect(
      storage.authorizeRead({
        storageKey: 'tenant-files/tenant-id/file-id/source',
        versionId: 'legacy-version',
        expiresInSeconds: 300,
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('preserves version-aware reads for local S3-compatible services', async () => {
    const storage = new S3CompatibleObjectStorage({
      ...r2Config,
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_FORCE_PATH_STYLE: true,
    });

    const authorization = await storage.authorizeRead({
      storageKey: 'tenant-files/tenant-id/file-id/source',
      versionId: 'minio-version',
      expiresInSeconds: 300,
    });

    expect(new URL(authorization.readUrl).searchParams.get('versionId')).toBe('minio-version');
  });

  it('streams stored bytes to derive size, MIME, SHA-256, and a signature prefix', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      Buffer.from('image-payload'),
    ]);
    const body = Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]);
    const storage = createStorageWithResponse({
      Body: body as unknown as NonNullable<GetObjectCommandOutput['Body']>,
      ContentLength: bytes.byteLength,
      ContentType: 'image/png; charset=binary',
      VersionId: undefined,
    });

    const actual = await storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024);

    expect(actual).toEqual({
      contentType: 'image/png',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('base64'),
      versionId: null,
      prefix: new Uint8Array(bytes.subarray(0, 16)),
    });
    expect(storage.command).toBeInstanceOf(GetObjectCommand);
    expect(storage.command?.input).toMatchObject({
      Bucket: 'private-files',
      Key: 'tenant-files/file/source',
    });
  });

  it('does not retain provider version identifiers returned for R2 objects', async () => {
    const bytes = Buffer.from('synthetic R2 object');
    const storage = createStorageWithResponse({
      Body: Readable.from([bytes]) as unknown as NonNullable<GetObjectCommandOutput['Body']>,
      ContentLength: bytes.byteLength,
      ContentType: 'application/octet-stream',
      VersionId: 'r2-provider-version',
    });

    const actual = await storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024);

    expect(actual?.versionId).toBeNull();
    expect(actual?.sha256).toBe(createHash('sha256').update(bytes).digest('base64'));
  });

  it('hashes streamed bytes instead of trusting provider checksums or custom metadata', async () => {
    const storedBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('actual stored content'),
    ]);
    const claimedSha256 = createHash('sha256').update('client-claimed content').digest('base64');
    const storage = createStorageWithResponse({
      Body: Readable.from([storedBytes]) as unknown as NonNullable<GetObjectCommandOutput['Body']>,
      ContentLength: storedBytes.byteLength,
      ContentType: 'image/png',
      ChecksumSHA256: claimedSha256,
      Metadata: { sha256: claimedSha256 },
    });

    const actual = await storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024);

    expect(actual?.sha256).toBe(createHash('sha256').update(storedBytes).digest('base64'));
    expect(actual?.sha256).not.toBe(claimedSha256);
  });

  it('stops streaming after one byte beyond the configured upload limit', async () => {
    const body = Readable.from([Buffer.alloc(102), Buffer.alloc(100)]);
    const storage = createStorageWithResponse({
      Body: body as unknown as NonNullable<GetObjectCommandOutput['Body']>,
      ContentLength: 202,
      ContentType: 'application/pdf',
    });

    const actual = await storage.adapter.inspectUploadedObject('tenant-files/file/source', 100);

    expect(actual).toMatchObject({ byteSize: 101, sha256: null });
    expect(actual?.prefix.byteLength).toBe(16);
    expect(body.destroyed).toBe(true);
  });

  it('treats a missing object as not uploaded yet', async () => {
    const storage = createStorageWithFailure(
      Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
    );

    await expect(
      storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024),
    ).resolves.toBeNull();
  });

  it('fails closed when the object stream ends with a provider error', async () => {
    function* failingObjectBody(): Generator<Uint8Array> {
      yield Buffer.from('partial object');
      throw new Error('private stream failure');
    }
    const storage = createStorageWithResponse({
      Body: Readable.from(failingObjectBody()) as unknown as NonNullable<GetObjectCommandOutput['Body']>,
      ContentLength: 128,
      ContentType: 'application/pdf',
    });

    await expect(
      storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('maps storage failures to a safe dependency error', async () => {
    const storage = createStorageWithFailure(new Error('private provider detail'));

    await expect(
      storage.adapter.inspectUploadedObject('tenant-files/file/source', 1024),
    ).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      message: 'Object storage is temporarily unavailable.',
    });
  });

  it.each([
    { label: 'authorization failures', failureClass: 'authorization', statusCode: 403, errorName: 'AccessDenied' },
    { label: 'configuration failures', failureClass: 'configuration', statusCode: 400, errorName: 'InvalidRequest' },
    { label: 'temporary provider failures', failureClass: 'dependency', statusCode: 503, errorName: 'ServiceUnavailable' },
  ])('logs safe context for $label', async ({ failureClass, statusCode, errorName }) => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = Object.assign(new Error('private key and object path'), {
      name: errorName,
      $metadata: { httpStatusCode: statusCode, requestId: 'safe-request-id' },
    });
    const storage = createStorageWithFailure(error);

    await expect(
      storage.adapter.inspectUploadedObject('tenant-files/private/path', 1024),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);

    expect(warning).toHaveBeenCalledWith(
      { operation: 'inspect_uploaded_object', failureClass, statusCode, requestId: 'safe-request-id' },
      'object storage operation failed',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private key and object path');
    warning.mockRestore();
  });

  it('treats deleting a missing object as an idempotent success', async () => {
    const client = new S3Client({
      endpoint: r2Config.OBJECT_STORAGE_ENDPOINT,
      region: r2Config.OBJECT_STORAGE_REGION,
      credentials: {
        accessKeyId: r2Config.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: r2Config.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    });
    const send = vi
      .spyOn(client, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NotFound' }));
    const storage = new S3CompatibleObjectStorage(r2Config, client);

    await expect(storage.deleteObject('tenant-files/file/source')).resolves.toBeUndefined();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });
});

function createStorageWithResponse(response: Partial<GetObjectCommandOutput>): {
  adapter: S3CompatibleObjectStorage;
  command: GetObjectCommand | undefined;
} {
  const client = new S3Client({
    endpoint: r2Config.OBJECT_STORAGE_ENDPOINT,
    region: r2Config.OBJECT_STORAGE_REGION,
    credentials: {
      accessKeyId: r2Config.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: r2Config.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  const send = vi.spyOn(client, 'send').mockReturnValue(
    Promise.resolve(response as GetObjectCommandOutput) as never,
  );
  return {
    adapter: new S3CompatibleObjectStorage(r2Config, client),
    get command() {
      return send.mock.calls[0]?.[0] as GetObjectCommand | undefined;
    },
  };
}

function createStorageWithFailure(error: Error): { adapter: S3CompatibleObjectStorage } {
  const client = new S3Client({
    endpoint: r2Config.OBJECT_STORAGE_ENDPOINT,
    region: r2Config.OBJECT_STORAGE_REGION,
    credentials: {
      accessKeyId: r2Config.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: r2Config.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  vi.spyOn(client, 'send').mockRejectedValue(error);
  return { adapter: new S3CompatibleObjectStorage(r2Config, client) };
}
