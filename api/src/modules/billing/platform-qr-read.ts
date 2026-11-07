import { createHash } from 'node:crypto';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { DependencyUnavailableError, NotFoundError } from '../../shared/errors.js';

export type PlatformQrRecord = {
  qr_image: Buffer | null;
  qr_mime: string;
  qr_object_key: string | null;
  qr_size_bytes: number | null;
  qr_sha256: string | null;
};

export async function readPlatformQrBytes(qr: PlatformQrRecord, storage: Pick<ObjectStorage, 'readObject'>, signal?: AbortSignal): Promise<Buffer> {
  if (qr.qr_image) return qr.qr_image;
  if (!qr.qr_object_key || !qr.qr_object_key.startsWith('platform-files/payment-methods/') || !qr.qr_size_bytes || qr.qr_size_bytes > 512 * 1024 || !qr.qr_sha256) {
    throw new DependencyUnavailableError('Stored QR metadata is invalid.');
  }
  const object = await storage.readObject({ storageKey: qr.qr_object_key, ...(signal ? { signal } : {}) });
  if (!object) throw new DependencyUnavailableError('The stored QR image is unavailable.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of object.body) {
    size += chunk.byteLength;
    if (size > qr.qr_size_bytes) throw new DependencyUnavailableError('The stored QR image is invalid.');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (size !== qr.qr_size_bytes || createHash('sha256').update(bytes).digest('hex') !== qr.qr_sha256) {
    throw new DependencyUnavailableError('The stored QR image is invalid.');
  }
  return bytes;
}

export function platformQrMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new NotFoundError('This QR code is not available.');
}
