import type { Request, Response } from 'express';

import { ForbiddenError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { getWorkspaces } from './tenancy.service.js';

export async function getWorkspacesController(req: Request, res: Response): Promise<void> {
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!principalId) throw new ForbiddenError('Staff context is required.');
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const result = await getWorkspaces({
    principalId,
    ...(cursor ? { cursor } : {}),
    limit: typeof req.query.limit === 'number' ? req.query.limit : Number(req.query.limit ?? 20),
  });
  sendSuccess(req, res, result);
}

export function getActorContextController(req: Request, res: Response): void {
  if (!req.actorContext) throw new ForbiddenError('Tenant context is required.');
  sendSuccess(req, res, req.actorContext);
}
