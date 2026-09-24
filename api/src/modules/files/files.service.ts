import { randomUUID } from 'node:crypto';

import {
  uploadAuthorizationRequest,
  uploadAuthorizationResponse,
  uploadFinalizeResponse,
  type PermissionCode,
  type TenantStatus,
  type UploadAuthorizationRequest,
  type UploadAuthorizationResponse,
  type UploadFinalizeResponse,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage, UploadedObjectMetadata } from '../../integrations/storage/object-storage.js';
import { s3ObjectStorage } from '../../integrations/storage/s3-object-storage.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
import {
  acceptFileObject,
  appendFileAuditEvent,
  insertPendingFile,
  readFileObject,
  rejectFileObject,
  type FileObjectRow,
} from './files.repository.js';

const AUTHORIZE_UPLOAD_OPERATION = 'files.upload.authorize';
const FINALIZE_UPLOAD_OPERATION = 'files.upload.finalize';
const UPLOAD_EXPIRY_SECONDS = 10 * 60;
const CATALOGUE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const CATALOGUE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type FileCommandBody<T> = SuccessEnvelope<T> | FailureEnvelope;

export interface FileCommandResponse<T> {
  status: number;
  body: FileCommandBody<T>;
}

interface FileContext {
  tenantId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

interface FileCommandContext extends FileContext {
  requestId: string;
  idempotencyKey: string;
}

export async function authorizeUpload(
  input: FileCommandContext & { request: UploadAuthorizationRequest },
  storage: ObjectStorage = s3ObjectStorage,
): Promise<FileCommandResponse<UploadAuthorizationResponse>> {
  assertFileWriteContext(input);
  const parsed = uploadAuthorizationRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Upload authorization request is invalid.');
  const request = parsed.data;
  assertSupportedCatalogueUpload(request);
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: AUTHORIZE_UPLOAD_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<UploadAuthorizationResponse>(claim);
    if (replay) return replay;

    try {
      const fileId = randomUUID();
      const storageKey = `tenant-files/${input.tenantId}/${fileId}/source`;
      const authorization = await storage.authorizeUpload({
        storageKey,
        contentType: request.content_type,
        sha256: request.sha256,
        expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
      });
      await insertPendingFile(client, {
        id: fileId,
        tenantId: input.tenantId,
        purpose: request.purpose,
        storageKey,
        sha256: request.sha256,
        mimeType: request.content_type,
        byteSize: request.byte_size,
        uploadExpiresAt: authorization.expiresAt,
      });
      const data = uploadAuthorizationResponse.parse({
        file_id: fileId,
        upload_url: authorization.uploadUrl,
        upload_method: 'PUT',
        required_headers: authorization.requiredHeaders,
        expires_at: authorization.expiresAt.toISOString(),
      });
      const body = successBody(input.requestId, data);

      await appendFileAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'file.upload.authorized',
        fileId,
        redactedSummary: {
          purpose: request.purpose,
          content_type: request.content_type,
          byte_size: request.byte_size,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: AUTHORIZE_UPLOAD_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure<UploadAuthorizationResponse>(
        client,
        input,
        AUTHORIZE_UPLOAD_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function finalizeUpload(
  input: FileCommandContext & { fileId: string },
  storage: ObjectStorage = s3ObjectStorage,
): Promise<FileCommandResponse<UploadFinalizeResponse>> {
  assertFileWriteContext(input);
  const payloadHash = canonicalRequestHash({ file_id: input.fileId });

  const before = await withTenantTransaction(input.tenantId, input.principalId, (client) =>
    readFileObject(client, input.tenantId, input.fileId),
  );
  if (!before) throw new NotFoundError('The uploaded file could not be found.');
  assertCatalogueFilePurpose(before);

  if (before.lifecycle_status === 'accepted') {
    return finalizeAcceptedReplay(input, before, payloadHash);
  }
  if (before.lifecycle_status === 'rejected' || before.lifecycle_status === 'deleted') {
    throw new StateConflictError('This upload can no longer be finalized.');
  }

  const uploaded = await storage.inspectUploadedObject(before.storage_key);
  if (!uploaded) {
    throw new StateConflictError('The uploaded object is not available yet.');
  }
  const validationError = validateUploadedObject(before, uploaded);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const locked = await readFileObject(client, input.tenantId, input.fileId, { forUpdate: true });
    if (!locked) throw new NotFoundError('The uploaded file could not be found.');
    assertCatalogueFilePurpose(locked);

    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: FINALIZE_UPLOAD_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<UploadFinalizeResponse>(claim);
    if (replay) return replay;

    try {
      if (locked.lifecycle_status === 'accepted') {
        const body = successBody(input.requestId, toFinalizeResponse(locked));
        await finalizeSuccess(client, input, payloadHash, body);
        return { status: 200, body };
      }
      if (locked.lifecycle_status === 'rejected' || locked.lifecycle_status === 'deleted') {
        throw new StateConflictError('This upload can no longer be finalized.');
      }

      if (validationError) {
        await rejectFileObject(client, input.tenantId, input.fileId);
        await appendFileAuditEvent(client, {
          tenantId: input.tenantId,
          actorKey: input.principalId,
          action: 'file.upload.rejected',
          fileId: input.fileId,
          redactedSummary: { reason: validationError },
          requestId: input.requestId,
          outcome: 'failed',
        });
        throw new ValidationError(validationError);
      }

      const accepted = await acceptFileObject(client, {
        tenantId: input.tenantId,
        fileId: input.fileId,
        versionId: uploaded.versionId,
      });
      if (!accepted) throw new StateConflictError('This upload changed while it was being finalized.');
      const data = toFinalizeResponse(accepted);
      const body = successBody(input.requestId, data);
      await appendFileAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'file.upload.accepted',
        fileId: input.fileId,
        redactedSummary: {
          purpose: accepted.purpose,
          content_type: accepted.mime_type,
          byte_size: accepted.byte_size,
        },
        requestId: input.requestId,
      });
      await finalizeSuccess(client, input, payloadHash, body);
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure<UploadFinalizeResponse>(
        client,
        input,
        FINALIZE_UPLOAD_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

function assertFileWriteContext(input: FileContext): void {
  if (input.effectiveTenantStatus === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('assets.manage')) {
    throw new ForbiddenError('This branch does not grant clothing file management access.');
  }
}

function assertSupportedCatalogueUpload(request: UploadAuthorizationRequest): void {
  if (
    request.purpose !== 'catalogue_image' &&
    request.purpose !== 'measurement_guide' &&
    request.purpose !== 'storefront_asset'
  ) {
    throw new ValidationError('This upload purpose is not available through the image upload flow.');
  }
  if (!CATALOGUE_IMAGE_MIME_TYPES.has(request.content_type)) {
    throw new ValidationError('Images must be JPEG, PNG, or WebP.');
  }
  if (request.byte_size > CATALOGUE_IMAGE_MAX_BYTES) {
    throw new ValidationError('Images must be 10 MB or smaller.');
  }
}

function assertCatalogueFilePurpose(row: FileObjectRow): void {
  if (
    row.purpose !== 'catalogue_image' &&
    row.purpose !== 'measurement_guide' &&
    row.purpose !== 'storefront_asset'
  ) {
    throw new NotFoundError('The uploaded file could not be found.');
  }
}

function validateUploadedObject(row: FileObjectRow, uploaded: UploadedObjectMetadata): string | null {
  if (uploaded.byteSize !== row.byte_size) return 'Uploaded file size does not match the authorized size.';
  if (uploaded.contentType !== row.mime_type) return 'Uploaded file type does not match the authorized type.';
  if (!uploaded.sha256 || uploaded.sha256 !== row.sha256) {
    return 'Uploaded file checksum does not match the authorized content.';
  }
  if (!matchesImageSignature(uploaded.prefix, row.mime_type)) {
    return 'Uploaded file contents do not match the declared image type.';
  }
  return null;
}

function matchesImageSignature(prefix: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return expected.every((value, index) => prefix[index] === value);
  }
  if (mimeType === 'image/webp') {
    return (
      prefix.length >= 12 &&
      ascii(prefix, 0, 4) === 'RIFF' &&
      ascii(prefix, 8, 12) === 'WEBP'
    );
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function finalizeAcceptedReplay(
  input: FileCommandContext & { fileId: string },
  row: FileObjectRow,
  payloadHash: string,
): Promise<FileCommandResponse<UploadFinalizeResponse>> {
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: FINALIZE_UPLOAD_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<UploadFinalizeResponse>(claim);
    if (replay) return replay;
    const data = toFinalizeResponse(row);
    const body = successBody(input.requestId, data);
    await finalizeSuccess(client, input, payloadHash, body);
    return { status: 200, body };
  });
}

function toFinalizeResponse(row: FileObjectRow): UploadFinalizeResponse {
  if (!row.sha256 || !row.frozen_at || row.lifecycle_status !== 'accepted') {
    throw new StateConflictError('Accepted file metadata is incomplete.');
  }
  return uploadFinalizeResponse.parse({
    file: {
      file_id: row.id,
      purpose: row.purpose,
      lifecycle_status: 'accepted',
      content_type: row.mime_type,
      byte_size: row.byte_size,
      sha256: row.sha256,
      frozen_at: row.frozen_at.toISOString(),
    },
  });
}

async function finalizeSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  input: FileCommandContext,
  payloadHash: string,
  body: SuccessEnvelope<UploadFinalizeResponse>,
): Promise<void> {
  await finalizeTenantIdempotency(client, {
    tenantId: input.tenantId,
    principalKey: input.membershipId,
    operation: FINALIZE_UPLOAD_OPERATION,
    intentKey: input.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
}

function replayOrThrow<T>(claim: Awaited<ReturnType<typeof claimTenantIdempotency>>): FileCommandResponse<T> | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as FileCommandBody<T> };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical request is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeKnownFailure<T>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  input: FileCommandContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<FileCommandResponse<T>> {
  if (!isAppError(error)) throw error;
  const body = failureBody(input.requestId, error.code, error.message);
  await finalizeTenantIdempotency(client, {
    tenantId: input.tenantId,
    principalKey: input.membershipId,
    operation,
    intentKey: input.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}

function successBody<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { success: true, data, request_id: requestId };
}

function failureBody(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}
