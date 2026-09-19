import express, { type Request, type RequestHandler, type Router } from 'express';
import {
  createSupportGrantRequest,
  operatorActivityQuery,
  operatorActivityResponse,
  retryCommandParams,
  retryCommandRequest,
  retryCommandResponse,
  revokeSupportGrantRequest,
  supportGrantParams,
  supportGrantResponse,
} from '@drezivo/contracts';
import { sendError, sendSuccess } from '../../shared/response.js';

export type OperatorPrincipal = { subject: string };
export type OperatorScope = { tenantId: string; permissions: string[] };

export interface InternalOperatorService {
  activity(input: { query: unknown; principal: OperatorPrincipal; scope: OperatorScope }): Promise<unknown>;
  createGrant(input: { body: unknown; principal: OperatorPrincipal; scope: OperatorScope; idempotencyKey: string; requestId: string }): Promise<unknown>;
  revokeGrant(input: { grantId: string; body: unknown; principal: OperatorPrincipal; scope: OperatorScope; idempotencyKey: string; requestId: string }): Promise<unknown>;
  retryJob(input: { jobId: string; body: unknown; principal: OperatorPrincipal; scope: OperatorScope; idempotencyKey: string; requestId: string }): Promise<unknown>;
  retryNotification(input: { deliveryId: string; body: unknown; principal: OperatorPrincipal; scope: OperatorScope; idempotencyKey: string; requestId: string }): Promise<unknown>;
}

export interface InternalOperatorRouteOptions {
  verifyServiceAuth?: (req: Request) => Promise<OperatorPrincipal | null>;
  resolveAuthorization?: (principal: OperatorPrincipal, req: Request) => Promise<OperatorScope | null>;
  service?: InternalOperatorService;
}

const genericUnavailable = 'This operator service is temporarily unavailable.';
const unauthorized = 'Operator authorization failed.';
const malformed = 'Request validation failed.';
const permissions = {
  activity: 'support.activity.read',
  createGrant: 'support.grant.create',
  revokeGrant: 'support.grant.revoke',
  retryJob: 'job.retry',
  retryNotification: 'notification.retry',
} as const;

function requireKey(req: Request): string | null {
  const key = req.header('Idempotency-Key')?.trim() ?? '';
  return /^[A-Za-z0-9_.:-]{16,200}$/.test(key) ? key : null;
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

function hasPermission(scope: OperatorScope, permission: string): boolean {
  return scope.permissions.includes(permission);
}

function sameSubject(subject: string, principal: OperatorPrincipal): boolean {
  return subject === principal.subject;
}

export function createInternalOperatorRouter(options: InternalOperatorRouteOptions = {}): Router {
  const router = express.Router();
  const verifier = options.verifyServiceAuth;
  const resolver = options.resolveAuthorization;
  const business = options.service;
  const getBusiness = (): InternalOperatorService => business ?? (() => { throw new Error('operator service unavailable'); })();
  const guard: RequestHandler = (req, res, next) => {
    if (!verifier || !resolver || !business) {
      sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId);
      return;
    }
    void verifier(req).then(async (principal) => {
      if (!principal) { sendError(res, 401, 'UNAUTHENTICATED', unauthorized, req.requestId); return; }
      const scope = await resolver(principal, req);
      if (!scope) { sendError(res, 403, 'FORBIDDEN', unauthorized, req.requestId); return; }
      res.locals.operatorPrincipal = principal;
      res.locals.operatorScope = scope;
      next();
    }).catch(() => sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId));
  };
  const handler = (fn: (req: Request, res: express.Response, principal: OperatorPrincipal, scope: OperatorScope) => Promise<unknown>): RequestHandler => (req, res) => {
    void fn(req, res, res.locals.operatorPrincipal as OperatorPrincipal, res.locals.operatorScope as OperatorScope)
      .then((data) => { if (!res.headersSent) sendSuccess(req, res, data); })
      .catch(() => sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId));
  };

  router.use(guard);
  router.get('/support-activity', handler(async (req, res, principal, scope) => {
    if (!hasPermission(scope, permissions.activity)) { sendError(res, 403, 'FORBIDDEN', unauthorized, req.requestId); return null; }
    const query = parse(operatorActivityQuery, req.query);
    if (!query) { sendError(res, 422, 'VALIDATION_FAILED', malformed, req.requestId); return null; }
    if (query.tenant_id && query.tenant_id !== scope.tenantId) { sendError(res, 404, 'NOT_FOUND', 'Resource not found.', req.requestId); return null; }
    const result = parse(operatorActivityResponse, await getBusiness().activity({ query, principal, scope }));
    if (!result) { sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId); return null; }
    return result;
  }));

  router.post('/support-grants', handler(async (req, res, principal, scope) => {
    if (!hasPermission(scope, permissions.createGrant)) { sendError(res, 403, 'FORBIDDEN', unauthorized, req.requestId); return null; }
    const body = parse(createSupportGrantRequest, req.body);
    const key = requireKey(req);
    if (!body || !key) { sendError(res, 422, 'VALIDATION_FAILED', malformed, req.requestId); return null; }
    if (body.tenant_id !== scope.tenantId || !sameSubject(body.operator_subject, principal)) { sendError(res, 404, 'NOT_FOUND', 'Resource not found.', req.requestId); return null; }
    const result = parse(supportGrantResponse, await getBusiness().createGrant({ body, principal, scope, idempotencyKey: key, requestId: req.requestId }));
    if (!result) { sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId); return null; }
    return result;
  }));

  router.post('/support-grants/:grantId/revoke', handler(async (req, res, principal, scope) => {
    if (!hasPermission(scope, permissions.revokeGrant)) { sendError(res, 403, 'FORBIDDEN', unauthorized, req.requestId); return null; }
    const params = parse(supportGrantParams, { grant_id: req.params.grantId });
    const body = parse(revokeSupportGrantRequest, req.body);
    const key = requireKey(req);
    if (!params || !body || !key) { sendError(res, 422, 'VALIDATION_FAILED', malformed, req.requestId); return null; }
    if (!sameSubject(body.operator_subject, principal)) { sendError(res, 404, 'NOT_FOUND', 'Resource not found.', req.requestId); return null; }
    const result = parse(supportGrantResponse, await getBusiness().revokeGrant({ grantId: params.grant_id, body, principal, scope, idempotencyKey: key, requestId: req.requestId }));
    if (!result) { sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId); return null; }
    return result;
  }));

  const retry = (kind: 'job' | 'notification'): RequestHandler => handler(async (req, res, principal, scope) => {
    const permission = kind === 'job' ? permissions.retryJob : permissions.retryNotification;
    if (!hasPermission(scope, permission)) { sendError(res, 403, 'FORBIDDEN', unauthorized, req.requestId); return null; }
    const params = parse(retryCommandParams, { resource_id: kind === 'job' ? req.params.jobId : req.params.deliveryId });
    const body = parse(retryCommandRequest, req.body);
    const key = requireKey(req);
    if (!params || !body || !key) { sendError(res, 422, 'VALIDATION_FAILED', malformed, req.requestId); return null; }
    if (!sameSubject(body.operator_subject, principal)) { sendError(res, 404, 'NOT_FOUND', 'Resource not found.', req.requestId); return null; }
    const input = { [kind === 'job' ? 'jobId' : 'deliveryId']: params.resource_id, body, principal, scope, idempotencyKey: key, requestId: req.requestId } as never;
    const value = kind === 'job' ? await getBusiness().retryJob(input) : await getBusiness().retryNotification(input);
    const result = parse(retryCommandResponse, value);
    if (!result) { sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', genericUnavailable, req.requestId); return null; }
    return result;
  });
  router.post('/jobs/:jobId/retry', retry('job'));
  router.post('/notifications/:deliveryId/retry', retry('notification'));
  return router;
}
