/**
 * TRD §4 `/uploads` POST — "Tenant/capability scope, size/type budget and
 * idempotency." TRD §7 — "Authorize upload purpose, expected size, content
 * types and owner before signing... S3 presigned URLs can be reused until
 * expiry and can overwrite an existing key. Therefore a successful upload
 * is not automatically immutable: finalize against an exact object
 * version/checksum."
 *
 * This module covers only the authorization handshake — the client PUTs
 * bytes directly to `upload_url` and never sends file contents through this
 * API. Finalization (freezing the accepted version, per TRD §7) happens as
 * part of the endpoint that references the resulting `file_id` (e.g.
 * `finance/receipts.ts` `paymentReceiptSubmitRequest`), not here.
 */
import { z } from 'zod';

import { fileObjectId } from '../common/ids';
import { isoInstant } from '../common/time';

/**
 * TRD §7 "Proposed limits: ten catalogue photos per style, 10 MB per source
 * image, 5 MB per proof image." This module enforces the outer bound (10
 * MB) common to every purpose; the tighter per-purpose limits are a server-
 * side policy check, not a wire-shape concern.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Data-Model §2 `file_object.purpose`. PRD §5: identity documents are opt-in, never default. */
export const filePurpose = z.enum(['catalogue_image', 'payment_evidence', 'identity_document']);
export type FilePurpose = z.infer<typeof filePurpose>;

const allowedContentType = z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** POST /uploads request body. Requires `Idempotency-Key`. */
export const uploadAuthorizationRequest = z.object({
  purpose: filePurpose,
  content_type: allowedContentType,
  byte_size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type UploadAuthorizationRequest = z.infer<typeof uploadAuthorizationRequest>;

export const uploadAuthorizationResponse = z.object({
  file_id: fileObjectId,
  upload_url: z.string().url(),
  upload_method: z.literal('PUT'),
  /** Headers the client must send verbatim on the PUT (e.g. `Content-Type`). */
  required_headers: z.record(z.string(), z.string()),
  expires_at: isoInstant,
});
export type UploadAuthorizationResponse = z.infer<typeof uploadAuthorizationResponse>;
