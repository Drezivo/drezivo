import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { MAX_STORED_OBJECT_READ_BYTES } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import type { FileStreamResponse } from './file-stream.js';
import {
  imageVariantStorageKey,
  supportsImageVariants,
  type ImageVariantWidth,
} from './files.storage-keys.js';

export const MEDIA_READ_GRANT_TTL_SECONDS = 60;

export interface MediaReadGrant {
  tenant_id: string;
  read_url: string;
  content_type: FileStreamResponse['mimeType'];
  byte_size: number;
  expires_at: string;
}

export async function createMediaReadGrant(
  input: {
    tenantId: string;
    fileId: string;
    purpose: string;
    storageKey: string;
    versionId: string | null;
    mimeType: FileStreamResponse['mimeType'];
    byteSize: number;
    width: ImageVariantWidth | null;
  },
  storage: ObjectStorage = objectStorage,
): Promise<MediaReadGrant> {
  let storageKey = input.storageKey;
  let versionId = input.versionId;
  let contentType = input.mimeType;
  let byteSize = input.byteSize;

  if (
    input.width !== null &&
    input.mimeType !== 'application/pdf' &&
    supportsImageVariants(input.purpose, input.mimeType) &&
    storage.headObject
  ) {
    const variantKey = imageVariantStorageKey({
      tenantId: input.tenantId,
      purpose: input.purpose,
      fileId: input.fileId,
      storageKey: input.storageKey,
      width: input.width,
    });
    if (variantKey) {
      const metadata = await storage.headObject(variantKey).catch(() => null);
      if (
        metadata?.contentType === 'image/webp' &&
        metadata.contentLength !== null &&
        metadata.contentLength > 0 &&
        metadata.contentLength <= MAX_STORED_OBJECT_READ_BYTES
      ) {
        storageKey = variantKey;
        versionId = null;
        contentType = 'image/webp';
        byteSize = metadata.contentLength;
      }
    }
  }

  const authorization = await storage.authorizeRead({
    storageKey,
    versionId,
    expiresInSeconds: MEDIA_READ_GRANT_TTL_SECONDS,
  });
  return {
    tenant_id: input.tenantId,
    read_url: authorization.readUrl,
    content_type: contentType,
    byte_size: byteSize,
    expires_at: authorization.expiresAt.toISOString(),
  };
}
