import type { Request, RequestHandler, Response } from 'express';

import { idempotencyKey, type PermissionCode, type TenantStatus } from '@drezivo/contracts';

import { ValidationError } from '../shared/errors.js';
import { rateLimit } from './rate-limit.js';
import type { CommandResult } from '../shared/idempotent-command.js';
import { sendSuccess } from '../shared/response.js';

export interface StaffContext {
  tenantId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
  requestId: string;
}

/** Server-resolved identity and tenant scope for the current staff request. Never read from the body. */
export function staffContextOf(req: Request): StaffContext {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const context = req.tenantContext;
  if (!principalId || !context) throw new ValidationError('Workspace context is required.');
  return {
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
    requestId: req.requestId,
  };
}

export function idempotencyKeyOf(req: Request): string {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) throw new ValidationError('A valid Idempotency-Key header is required.');
  return parsed.data;
}

/** Express 5 forwards rejected promises to the error handler, so handlers can simply be async. */
export function readHandler<T>(read: (req: Request) => Promise<T>): RequestHandler {
  return async (req: Request, res: Response) => {
    sendSuccess(req, res, await read(req));
  };
}

export function commandHandler<T>(run: (req: Request, key: string) => Promise<CommandResult<T>>): RequestHandler {
  return async (req: Request, res: Response) => {
    const result = await run(req, idempotencyKeyOf(req));
    res.status(result.status).json(result.body);
  };
}

/** Per-workspace request budget for staff routes. */
export function workspaceRateLimit(max: number): RequestHandler {
  return rateLimit({ windowMs: 60_000, max, keyOf: (req) => req.tenantContext?.tenantId ?? req.ip ?? 'unknown' });
}
