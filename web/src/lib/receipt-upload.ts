import type { GuestReceiptUploadRequest, GuestReservationView } from '@drezivo/contracts';

import { authorizeReceipt, StorefrontApiError, submitReceipt } from './storefront-api';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const MAX_BYTES = 10 * 1024 * 1024;

export function receiptProblem(file: File): string | null {
  if (!TYPES.includes(file.type as (typeof TYPES)[number])) return 'Upload a JPG, PNG, WebP, or PDF.';
  if (file.size > MAX_BYTES) return 'The receipt must be 10 MB or smaller.';
  return null;
}

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  let binary = '';
  digest.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Authorize → create-only PUT straight to storage → submit. The server re-checks size, type,
 * SHA-256, and file signature, and binds the file to this booking before accepting it.
 * `idempotencyKey` is per chosen file, so a retry after a timeout cannot submit twice.
 */
export async function uploadReceipt(reservationId: string, token: string, file: File, idempotencyKey: string): Promise<GuestReservationView> {
  const problem = receiptProblem(file);
  if (problem) throw new StorefrontApiError(problem, 422, 'VALIDATION_FAILED');
  const request: GuestReceiptUploadRequest = {
    content_type: file.type as GuestReceiptUploadRequest['content_type'],
    byte_size: file.size,
    sha256: await sha256Base64(file),
  };
  const authorized = await authorizeReceipt(reservationId, token, request);
  let uploaded: Response;
  try {
    uploaded = await fetch(authorized.upload_url, { method: 'PUT', headers: authorized.required_headers, body: file });
  } catch {
    throw new StorefrontApiError('The upload was interrupted. Check your connection and try again.', 503, 'NETWORK');
  }
  // A retry can receive 412 when the first create-only PUT succeeded but its response was lost.
  // Continue to submission so the API can verify the exact stored bytes against the expected hash.
  if (!uploaded.ok && uploaded.status !== 412) {
    throw new StorefrontApiError('The upload did not finish. Try again.', uploaded.status, 'UPLOAD_FAILED');
  }
  return submitReceipt(reservationId, token, authorized.file_id, idempotencyKey);
}
