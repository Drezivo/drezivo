import { Router } from 'express';

import { requireVerifiedStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  cancelMembershipInvitationController,
  claimMembershipInvitationController,
  createMembershipInvitationController,
  listMembershipInvitationsController,
  resendMembershipInvitationController,
} from './membership-invitations.controller.js';
import {
  requireMembershipInvitationIdempotencyKey,
  requireMembershipInvitationClaimIdempotencyKey,
  requireActiveClerkOrganization,
  requireMembershipInvitationOwner,
  validateCreateMembershipInvitation,
  validateClaimMembershipInvitationBody,
  validateEmptyInvitationBody,
  validateMembershipInvitationPagination,
  validateMembershipInvitationTarget,
} from './membership-invitations.middleware.js';

export const membershipInvitationsRouter = Router();

const ownerRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const tenantRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.ip ?? 'unknown',
});

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const claimUserRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const claimNetworkRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) => req.ip ?? 'unknown',
});

const invitationPolicy = requireTenantAction('invitation');

membershipInvitationsRouter.post(
  '/membership-invitations/:invitationId/claim',
  requireVerifiedStaffAuth,
  claimUserRateLimit,
  claimNetworkRateLimit,
  validateMembershipInvitationTarget,
  validateClaimMembershipInvitationBody,
  requireActiveClerkOrganization,
  requireMembershipInvitationClaimIdempotencyKey,
  claimMembershipInvitationController,
);

membershipInvitationsRouter.get(
  '/membership-invitations',
  requireVerifiedStaffAuth,
  requireTenantContext,
  readRateLimit,
  invitationPolicy,
  requireMembershipInvitationOwner,
  validateMembershipInvitationPagination,
  listMembershipInvitationsController,
);

membershipInvitationsRouter.post(
  '/membership-invitations',
  requireVerifiedStaffAuth,
  requireTenantContext,
  ownerRateLimit,
  tenantRateLimit,
  invitationPolicy,
  requireMembershipInvitationOwner,
  validateCreateMembershipInvitation,
  requireMembershipInvitationIdempotencyKey,
  createMembershipInvitationController,
);

membershipInvitationsRouter.post(
  '/membership-invitations/:invitationId/resend',
  requireVerifiedStaffAuth,
  requireTenantContext,
  ownerRateLimit,
  tenantRateLimit,
  invitationPolicy,
  requireMembershipInvitationOwner,
  validateMembershipInvitationTarget,
  validateEmptyInvitationBody,
  requireMembershipInvitationIdempotencyKey,
  resendMembershipInvitationController,
);

membershipInvitationsRouter.post(
  '/membership-invitations/:invitationId/cancel',
  requireVerifiedStaffAuth,
  requireTenantContext,
  ownerRateLimit,
  tenantRateLimit,
  invitationPolicy,
  requireMembershipInvitationOwner,
  validateMembershipInvitationTarget,
  validateEmptyInvitationBody,
  requireMembershipInvitationIdempotencyKey,
  cancelMembershipInvitationController,
);
