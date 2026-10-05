import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { listTenantMembers } from './members.service.js';

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
