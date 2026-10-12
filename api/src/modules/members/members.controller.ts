import type { Request, Response } from 'express';
import { z } from 'zod';

import { idempotencyKey as idempotencyKeySchema } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { listTenantMembers, removeTenantMember } from './members.service.js';

const memberTargetParams = z.object({ membershipId: z.string().uuid() }).strict();
const emptyBody = z.object({}).strict();

export async function listTenantMembersController(req: Request, res: Response): Promise<void> {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ValidationError('Tenant context is required.');

  const result = await listTenantMembers({
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    principalId,
  });
  sendSuccess(req, res, result);
}

export async function removeTenantMemberController(req: Request, res: Response): Promise<void> {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ValidationError('Tenant context is required.');
  const params = memberTargetParams.safeParse(req.params);
  if (!params.success) throw new ValidationError('Member ID is invalid.');
  if (!emptyBody.safeParse(req.body ?? {}).success) throw new ValidationError('Member removal takes no request body.');
  const key = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
  if (!key.success) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await removeTenantMember({
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    principalId,
    requestId: req.requestId,
    idempotencyKey: key.data,
    targetMembershipId: params.data.membershipId,
  });
  res.status(result.status).json(result.body);
}
