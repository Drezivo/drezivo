import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  cancelMembershipInvitation,
  createMembershipInvitation,
  listMembershipInvitations,
  resendMembershipInvitation,
} from './membership-invitations.service.js';
import { claimMembershipInvitation } from './membership-invitation-claim.service.js';
import type {
  CreateMembershipInvitationRequest,
  PaginationRequest,
} from './membership-invitations.schemas.js';

export async function createMembershipInvitationController(
  req: Request,
  res: Response,
): Promise<void> {
  const context = requireContext(req);
  const result = await createMembershipInvitation({
    ...context,
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as CreateMembershipInvitationRequest,
  });
  res.status(result.status).json(result.body);
}

export async function listMembershipInvitationsController(
  req: Request,
  res: Response,
): Promise<void> {
  const context = requireContext(req);
  const page = req.query as unknown as PaginationRequest;
  const result = await listMembershipInvitations({ ...context, ...page });
  sendSuccess(req, res, result);
}

export async function resendMembershipInvitationController(
  req: Request,
  res: Response,
): Promise<void> {
  const context = requireContext(req);
  const result = await resendMembershipInvitation({
    ...context,
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    invitationId: requireInvitationId(req),
  });
  res.status(result.status).json(result.body);
}

export async function cancelMembershipInvitationController(
  req: Request,
  res: Response,
): Promise<void> {
  const context = requireContext(req);
  const result = await cancelMembershipInvitation({
    ...context,
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    invitationId: requireInvitationId(req),
  });
  res.status(result.status).json(result.body);
}

export async function claimMembershipInvitationController(
  req: Request,
  res: Response,
): Promise<void> {
  const principal = req.clerkPrincipal;
  const invitationId = requireInvitationId(req);
  const idempotencyKey = req.membershipInvitationClaimIdempotencyKey;
  if (!principal?.clerkUserId || !principal.clerkOrgId) {
    throw new ValidationError('The invitation is not available.');
  }
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');
  const result = await claimMembershipInvitation({
    invitationId,
    clerkUserId: principal.clerkUserId,
    clerkOrgId: principal.clerkOrgId,
    requestId: req.requestId,
    idempotencyKey,
  });
  res.status(result.status).json(result.body);
}

function requireContext(req: Request): {
  tenantId: string;
  membershipId: string;
  principalId: string;
} {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ValidationError('Tenant context is required.');
  return { tenantId: context.tenantId, membershipId: context.membershipId, principalId };
}

function requireIdempotencyKey(req: Request): string {
  const value = req.membershipInvitationIdempotencyKey;
  if (!value) throw new ValidationError('A valid Idempotency-Key header is required.');
  return value;
}

function requireInvitationId(req: Request): string {
  const value = req.params.invitationId;
  if (typeof value !== 'string') throw new ValidationError('Invitation ID is required.');
  return value;
}
