import { DependencyUnavailableError } from '../../shared/errors.js';

export interface UploadAuthorization {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
}

export interface UploadedObjectMetadata {
  contentType: string;
  byteSize: number;
  sha256: string | null;
  versionId: string | null;
  prefix: Uint8Array;
}

export interface ReadAuthorization {
  readUrl: string;
  expiresAt: Date;
}

export interface StoredObjectRead {
  /** Streaming body from the private bucket; callers must authorize the database file first. */
  body: AsyncIterable<Uint8Array>;
  contentLength: number | null;
}

export interface StoredObjectMetadata {
  contentType: string | null;
  contentLength: number | null;
}

export interface ObjectStorage {
  authorizeUpload(input: {
    storageKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<UploadAuthorization>;
  authorizeRead(input: {
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }): Promise<ReadAuthorization>;
  readObject(input: {
    storageKey: string;
    versionId?: string | null;
  }): Promise<StoredObjectRead | null>;
  headObject?(storageKey: string): Promise<StoredObjectMetadata | null>;
  putObject?(input: { storageKey: string; contentType: string; body: Uint8Array }): Promise<void>;
  inspectUploadedObject(
    storageKey: string,
    maxByteSize: number,
  ): Promise<UploadedObjectMetadata | null>;
  deleteObject?(storageKey: string): Promise<void>;
}

export const MAX_STORED_OBJECT_READ_BYTES = 10 * 1024 * 1024;

/** Stops a corrupted or replaced object from streaming beyond its verified file metadata. */
export function boundStoredObjectBody(
  body: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): AsyncIterable<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > MAX_STORED_OBJECT_READ_BYTES
  ) {
    throw new DependencyUnavailableError('Stored file metadata is invalid.');
  }

  return (async function* boundedBody() {
    let observedBytes = 0;
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > expectedBytes - observedBytes) {
        throw new Error('Stored file exceeded its verified byte size.');
      }
      observedBytes += chunk.byteLength;
      yield chunk;
    }
    if (observedBytes !== expectedBytes) {
      throw new Error('Stored file did not match its verified byte size.');
    }
  })();
}
