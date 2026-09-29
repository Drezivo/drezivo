import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { config, type Config } from '../../config/index.js';
import { DependencyUnavailableError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import type {
  ObjectStorage,
  ReadAuthorization,
  UploadAuthorization,
  UploadedObjectMetadata,
} from './object-storage.js';

type StorageConfig = Pick<
  Config,
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_REGION'
  | 'OBJECT_STORAGE_BUCKET_PRIVATE'
  | 'OBJECT_STORAGE_ACCESS_KEY_ID'
  | 'OBJECT_STORAGE_SECRET_ACCESS_KEY'
  | 'OBJECT_STORAGE_FORCE_PATH_STYLE'
>;

const MAX_PRESIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const INSPECTION_PREFIX_BYTES = 16;

type StorageOperation = 'authorize_upload' | 'authorize_read' | 'inspect_uploaded_object' | 'delete_object';
type StorageFailureClass = 'authorization' | 'configuration' | 'dependency';

export class S3CompatibleObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly storageConfig: StorageConfig = config,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client(createClientConfig(storageConfig));
  }

  async authorizeUpload(input: {
    storageKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<UploadAuthorization> {
    assertPresignedUrlExpiry(input.expiresInSeconds);
    const now = new Date();
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.storageConfig.OBJECT_STORAGE_BUCKET_PRIVATE,
          Key: input.storageKey,
          ContentType: input.contentType,
          IfNoneMatch: '*',
        }),
        {
          expiresIn: input.expiresInSeconds,
          signableHeaders: new Set(['content-type']),
        },
      );
    } catch (error) {
      throw mapStorageFailure(error, 'authorize_upload');
    }

    return {
      uploadUrl,
      requiredHeaders: {
        'Content-Type': input.contentType,
        'If-None-Match': '*',
      },
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async authorizeRead(input: {
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }): Promise<ReadAuthorization> {
    assertPresignedUrlExpiry(input.expiresInSeconds);
    if (input.versionId && isR2Endpoint(this.storageConfig.OBJECT_STORAGE_ENDPOINT)) {
      throw new DependencyUnavailableError(
        'Legacy versioned objects must be reconciled before they can be read from Cloudflare R2.',
      );
    }

    const now = new Date();
    let readUrl: string;
    try {
      readUrl = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.storageConfig.OBJECT_STORAGE_BUCKET_PRIVATE,
          Key: input.storageKey,
          ...(input.versionId ? { VersionId: input.versionId } : {}),
        }),
        { expiresIn: input.expiresInSeconds },
      );
    } catch (error) {
      throw mapStorageFailure(error, 'authorize_read');
    }

    return {
      readUrl,
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async inspectUploadedObject(
    storageKey: string,
    maxByteSize: number,
  ): Promise<UploadedObjectMetadata | null> {
    if (!Number.isSafeInteger(maxByteSize) || maxByteSize <= 0) {
      throw new Error('Object inspection requires a positive maximum byte size.');
    }

    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.storageConfig.OBJECT_STORAGE_BUCKET_PRIVATE,
          Key: storageKey,
        }),
      );
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw mapStorageFailure(error, 'inspect_uploaded_object');
    }

    if (!response.Body) {
      throw new DependencyUnavailableError('Object storage returned no uploaded file body.');
    }

    const hash = createHash('sha256');
    const prefix = new Uint8Array(INSPECTION_PREFIX_BYTES);
    let prefixByteSize = 0;
    let byteSize = 0;
    let exceedsLimit = false;

    const body = asAsyncByteStream(response.Body);
    try {
      for await (const chunk of body) {
        const remainingByteBudget = maxByteSize + 1 - byteSize;
        const acceptedChunk = chunk.subarray(0, remainingByteBudget);
        hash.update(acceptedChunk);
        byteSize += acceptedChunk.byteLength;

        const prefixBytes = Math.min(
          INSPECTION_PREFIX_BYTES - prefixByteSize,
          acceptedChunk.byteLength,
        );
        prefix.set(acceptedChunk.subarray(0, prefixBytes), prefixByteSize);
        prefixByteSize += prefixBytes;

        if (acceptedChunk.byteLength < chunk.byteLength || byteSize > maxByteSize) {
          exceedsLimit = true;
          body.destroy?.();
          break;
        }
      }
    } catch (error) {
      if (!exceedsLimit) throw mapStorageFailure(error, 'inspect_uploaded_object');
    }

    return {
      contentType: normalizeContentType(response.ContentType),
      byteSize,
      sha256: exceedsLimit ? null : hash.digest('base64'),
      versionId: response.VersionId ?? null,
      prefix: prefix.slice(0, prefixByteSize),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.storageConfig.OBJECT_STORAGE_BUCKET_PRIVATE,
          Key: storageKey,
        }),
      );
    } catch (error) {
      if (isMissingObject(error)) return;
      throw mapStorageFailure(error, 'delete_object');
    }
  }
}

export const objectStorage = new S3CompatibleObjectStorage();

function createClientConfig(storageConfig: StorageConfig): S3ClientConfig {
  return {
    endpoint: storageConfig.OBJECT_STORAGE_ENDPOINT,
    region: storageConfig.OBJECT_STORAGE_REGION,
    credentials: {
      accessKeyId: storageConfig.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: storageConfig.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: storageConfig.OBJECT_STORAGE_FORCE_PATH_STYLE,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  };
}

function assertPresignedUrlExpiry(expiresInSeconds: number): void {
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAX_PRESIGNED_URL_SECONDS
  ) {
    throw new Error('Object-storage signed URL expiry is outside the supported range.');
  }
}

function isR2Endpoint(endpoint: string): boolean {
  return new URL(endpoint).hostname.endsWith('.r2.cloudflarestorage.com');
}

function isMissingObject(error: unknown): boolean {
  const details = getErrorDetails(error);
  return (
    details.name === 'NoSuchKey' ||
    details.name === 'NotFound' ||
    details.statusCode === 404
  );
}

function mapStorageFailure(
  error: unknown,
  operation: StorageOperation,
): DependencyUnavailableError {
  const details = getErrorDetails(error);
  logger.warn(
    {
      operation,
      failureClass: classifyStorageFailure(details),
      ...(details.statusCode ? { statusCode: details.statusCode } : {}),
      ...(details.requestId ? { requestId: details.requestId } : {}),
    },
    'object storage operation failed',
  );
  return new DependencyUnavailableError('Object storage is temporarily unavailable.');
}

function getErrorDetails(error: unknown): {
  name: string | null;
  statusCode: number | null;
  requestId: string | null;
} {
  if (!error || typeof error !== 'object') {
    return { name: null, statusCode: null, requestId: null };
  }

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
  };
  const statusCode = candidate.$metadata?.httpStatusCode;
  const requestId = candidate.$metadata?.requestId;
  return {
    name: typeof candidate.name === 'string' ? candidate.name : null,
    statusCode:
      typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
        ? statusCode
        : null,
    requestId:
      typeof requestId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(requestId)
        ? requestId
        : null,
  };
}

function classifyStorageFailure(details: ReturnType<typeof getErrorDetails>): StorageFailureClass {
  if (
    details.statusCode === 401 ||
    details.statusCode === 403 ||
    details.name === 'AccessDenied' ||
    details.name === 'InvalidAccessKeyId' ||
    details.name === 'SignatureDoesNotMatch' ||
    details.name === 'ExpiredToken'
  ) {
    return 'authorization';
  }
  if (
    (details.statusCode !== null && details.statusCode >= 400 && details.statusCode < 500 && details.statusCode !== 429) ||
    details.name === 'CredentialsProviderError' ||
    details.name === 'EndpointError' ||
    details.name === 'InvalidConfiguration' ||
    details.name === 'InvalidRegion'
  ) {
    return 'configuration';
  }
  return 'dependency';
}

function normalizeContentType(value: string | undefined): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function asAsyncByteStream(
  body: NonNullable<GetObjectCommandOutput['Body']>,
): AsyncIterable<Uint8Array> & { destroy?: () => void } {
  const stream = body as unknown as {
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
    destroy?: () => void;
  };
  if (typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new DependencyUnavailableError('Object storage returned an unsupported file stream.');
  }
  return stream as AsyncIterable<Uint8Array> & { destroy?: () => void };
}
