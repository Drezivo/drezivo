/**
 * TRD §4 `/uploads` and TRD §7 files/privacy boundary.
 *
 * The browser never receives storage credentials. It asks Drezivo to authorize a bounded upload,
 * PUTs bytes directly to the returned signed URL, then asks Drezivo to finalize the exact object.
 * Finalization verifies provider metadata/checksum before a file can become `accepted` and be
 * referenced by catalogue/payment/storefront domain rows.
 */
import { z } from 'zod';

import { fileObjectId } from '../common/ids';
import { isoInstant } from '../common/time';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Canonical Data-Model `file_object.purpose` values. */
export const filePurpose = z.enum([
  'catalogue_image',
  'measurement_guide',
  'payment_receipt',
  'verification_document',
  'storefront_asset',
  'export_result',
]);
export type FilePurpose = z.infer<typeof filePurpose>;

export const fileLifecycleStatus = z.enum([
  'pending_upload',
  'uploaded',
  'scanning',
  'accepted',
  'rejected',
  'deleted',
]);
export type FileLifecycleStatus = z.infer<typeof fileLifecycleStatus>;

export const uploadContentType = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
export type UploadContentType = z.infer<typeof uploadContentType>;

/** Standard base64 SHA-256 digest verified against the actual stored bytes during finalization. */
export const sha256Base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be a standard base64 SHA-256 digest');
export type Sha256Base64 = z.infer<typeof sha256Base64>;

/** POST /uploads request body. Requires `Idempotency-Key`. */
export const uploadAuthorizationRequest = z
  .object({
    purpose: filePurpose,
    content_type: uploadContentType,
    byte_size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    sha256: sha256Base64,
  })
  .strict();
export type UploadAuthorizationRequest = z.infer<typeof uploadAuthorizationRequest>;

export const uploadAuthorizationResponse = z.object({
  file_id: fileObjectId,
  upload_url: z.string().url(),
  upload_method: z.literal('PUT'),
  /** Headers the client must send verbatim on the direct PUT. */
  required_headers: z.record(z.string(), z.string()),
  expires_at: isoInstant,
});
export type UploadAuthorizationResponse = z.infer<typeof uploadAuthorizationResponse>;

/** POST /uploads/{fileId}/finalize request body. Requires `Idempotency-Key`. */
export const uploadFinalizeRequest = z.object({}).strict();
export type UploadFinalizeRequest = z.infer<typeof uploadFinalizeRequest>;

export const finalizedFile = z.object({
  file_id: fileObjectId,
  purpose: filePurpose,
  lifecycle_status: z.literal('accepted'),
  content_type: uploadContentType,
  byte_size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sha256: sha256Base64,
  frozen_at: isoInstant,
});
export type FinalizedFile = z.infer<typeof finalizedFile>;

export const uploadFinalizeResponse = z.object({ file: finalizedFile });
export type UploadFinalizeResponse = z.infer<typeof uploadFinalizeResponse>;
