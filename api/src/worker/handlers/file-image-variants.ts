import sharp from 'sharp';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withSystemTenantTransaction } from '../../db/client.js';
import {
  MAX_STORED_OBJECT_READ_BYTES,
  type ObjectStorage,
} from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import {
  imageVariantStorageKey,
  IMAGE_VARIANT_WIDTHS,
  supportsImageVariants,
} from '../../modules/files/files.storage-keys.js';
import { readAcceptedImageVariantSource } from '../../modules/files/files.repository.js';
import { DeferredOutboxError, PermanentOutboxError, type EventHandler } from '../runner.js';
import type { ImageVariantWidth } from '../../modules/files/files.storage-keys.js';

const payloadSchema = z.object({ file_id: z.string().uuid() }).strict();
const MAX_IMAGE_PIXELS = 40_000_000;

type SystemTenantTransaction = <T>(
  tenantId: string,
  systemKey: string,
  callback: (client: PoolClient) => Promise<T>,
) => Promise<T>;

type ImageTransformer = (source: Buffer, width: ImageVariantWidth) => Promise<Buffer>;

/** Generates private, deterministic WebP derivatives under the accepted source's R2 key. */
export function createFileImageVariantsHandler(
  storage: Pick<ObjectStorage, 'readObject' | 'putObject'> = objectStorage,
  transaction: SystemTenantTransaction = withSystemTenantTransaction,
  transform: ImageTransformer = transformImage,
): EventHandler {
  return async (event) => {
    const parsed = payloadSchema.safeParse(event.payload);
    if (!parsed.success) throw new PermanentOutboxError('Image derivative event payload is invalid.');

    const source = await transaction(event.tenant_id, 'file-image-variants', (client) =>
      readAcceptedImageVariantSource(client, event.tenant_id, parsed.data.file_id),
    );
    if (!source || !supportsImageVariants(source.purpose, source.mime_type)) return;
    if (!storage.putObject) {
      throw new DeferredOutboxError('Object storage cannot write image derivatives yet.', 3600);
    }
    const putObject = storage.putObject.bind(storage);

    let original: Buffer;
    try {
      const object = await storage.readObject({ storageKey: source.storage_key, versionId: source.version_id });
      if (!object || (object.contentLength !== null && object.contentLength !== source.byte_size)) {
        throw new PermanentOutboxError('The accepted source image is unavailable or has changed.');
      }
      original = await readBoundedObject(object.body, source.byte_size);
    } catch (error) {
      if (error instanceof PermanentOutboxError) throw error;
      throw new Error('The accepted source image could not be read for derivative generation.', { cause: error });
    }

    const variants = new Map<ImageVariantWidth, Buffer>();
    for (const width of IMAGE_VARIANT_WIDTHS) {
      try {
        variants.set(width, await transform(original, width));
      } catch {
        throw new PermanentOutboxError('The accepted source image could not be decoded safely.');
      }
    }

    await transaction(event.tenant_id, 'file-image-variants', async (client) => {
      const locked = await readAcceptedImageVariantSource(client, event.tenant_id, parsed.data.file_id, true);
      if (
        !locked ||
        !supportsImageVariants(locked.purpose, locked.mime_type) ||
        locked.storage_key !== source.storage_key ||
        locked.version_id !== source.version_id ||
        locked.byte_size !== source.byte_size ||
        locked.sha256 !== source.sha256
      ) return;

      for (const width of IMAGE_VARIANT_WIDTHS) {
        const storageKey = imageVariantStorageKey({
          tenantId: locked.tenant_id,
          purpose: locked.purpose,
          fileId: locked.id,
          storageKey: locked.storage_key,
          width,
        });
        const body = variants.get(width);
        if (!storageKey || !body || body.byteLength < 1 || body.byteLength > MAX_STORED_OBJECT_READ_BYTES) {
          throw new PermanentOutboxError('Generated image derivative metadata is invalid.');
        }
        await putObject({ storageKey, contentType: 'image/webp', body });
      }
    });
  };
}

async function readBoundedObject(body: AsyncIterable<Uint8Array>, expectedByteSize: number): Promise<Buffer> {
  if (
    !Number.isSafeInteger(expectedByteSize) ||
    expectedByteSize < 1 ||
    expectedByteSize > MAX_STORED_OBJECT_READ_BYTES
  ) {
    throw new PermanentOutboxError('Accepted source image metadata is invalid.');
  }
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > expectedByteSize - byteSize) {
      throw new PermanentOutboxError('Accepted source image exceeded its verified size.');
    }
    byteSize += chunk.byteLength;
    chunks.push(Buffer.from(chunk));
  }
  if (byteSize !== expectedByteSize) {
    throw new PermanentOutboxError('Accepted source image did not match its verified size.');
  }
  return Buffer.concat(chunks, byteSize);
}

async function transformImage(source: Buffer, width: ImageVariantWidth): Promise<Buffer> {
  const image = sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new Error('Source image dimensions are outside the processing limit.');
  }
  return sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
    .rotate()
    .resize({ width, fit: 'inside', withoutEnlargement: true })
    // Preserve exact source colors/edges for uploaded PNGs such as QR codes and policy pages.
    .webp(metadata.format === 'png' ? { lossless: true, effort: 4 } : { quality: 82, effort: 4 })
    .toBuffer();
}

export const handleFileImageVariants = createFileImageVariantsHandler();
