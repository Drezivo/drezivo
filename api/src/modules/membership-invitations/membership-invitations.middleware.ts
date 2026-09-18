import type { RequestHandler } from 'express';

import { idempotencyKey as idempotencyKeySchema } from '@drezivo/contracts';

import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  cancelMembershipInvitationRequest,
  claimMembershipInvitationRequest,
  createMembershipInvitationRequest,
  membershipInvitationParams,
  paginationRequest,
  resendMembershipInvitationRequest,
} from './membership-invitations.schemas.js';

declare module 'express-serve-static-core' {
  interface Request {
    membershipInvitationIdempotencyKey?: string;
    membershipInvitationClaimIdempotencyKey?: string;
  }
}

export const requireMembershipInvitationOwner: RequestHandler = (req, _res, next): void => {
  if (req.tenantContext?.role !== 'owner') {
    next(new ForbiddenError('Only the tenant owner can manage invitations.'));
    return;
  }
  next();
};

export const requireMembershipInvitationIdempotencyKey: RequestHandler = (
  req,
  _res,
  next,
): void => {
  const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.membershipInvitationIdempotencyKey = parsed.data;
  next();
};

export const validateCreateMembershipInvitation: RequestHandler = (req, _res, next): void => {
  const parsed = createMembershipInvitationRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invitation request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateMembershipInvitationTarget: RequestHandler = (req, _res, next): void => {
  const params = membershipInvitationParams.safeParse(req.params);
  if (!params.success) {
    next(new ValidationError('Invitation ID is invalid.'));
    return;
  }
  req.params = params.data;
  next();
};

export const validateEmptyInvitationBody: RequestHandler = (req, _res, next): void => {
  const parsed = (
    req.method === 'POST' && req.path.endsWith('/resend')
      ? resendMembershipInvitationRequest
      : cancelMembershipInvitationRequest
  ).safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invitation request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateClaimMembershipInvitationBody: RequestHandler = (req, _res, next): void => {
  if (!claimMembershipInvitationRequest.safeParse(req.body).success) {
    next(new ValidationError('Invitation claim request is invalid.'));
    return;
  }
  next();
};

export const requireMembershipInvitationClaimIdempotencyKey: RequestHandler = (
  req,
  _res,
  next,
): void => {
  const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.membershipInvitationClaimIdempotencyKey = parsed.data;
  next();
};

export const requireActiveClerkOrganization: RequestHandler = (req, _res, next): void => {
  if (!req.clerkPrincipal?.clerkOrgId) {
    next(new NotFoundError('The invitation is not available.'));
    return;
  }
  next();
};

export const validateMembershipInvitationPagination: RequestHandler = (req, _res, next): void => {
  const parsed = paginationRequest.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Pagination is invalid.'));
    return;
  }
  req.query = parsed.data as unknown as typeof req.query;
  next();
};
