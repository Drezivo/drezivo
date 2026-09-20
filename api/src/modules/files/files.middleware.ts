import type { RequestHandler } from 'express';

import {
  fileObjectId,
  idempotencyKey,
  uploadAuthorizationRequest,
  uploadFinalizeRequest,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    fileUploadIdempotencyKey?: string;
    fileUploadFileId?: string;
  }
}

export const requireFileIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.fileUploadIdempotencyKey = parsed.data;
  next();
};

export const requireClothingFilePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('assets.manage')) {
    next(new ForbiddenError('This branch does not grant clothing file management access.'));
    return;
  }
  next();
};

export const validateUploadAuthorization: RequestHandler = (req, _res, next): void => {
  const parsed = uploadAuthorizationRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Upload authorization request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateUploadFinalize: RequestHandler = (req, _res, next): void => {
  const parsedId = fileObjectId.safeParse(req.params.fileId);
  const parsedBody = uploadFinalizeRequest.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    next(new ValidationError('Upload finalization request is invalid.'));
    return;
  }
  req.fileUploadFileId = parsedId.data;
  req.body = parsedBody.data;
  next();
};
