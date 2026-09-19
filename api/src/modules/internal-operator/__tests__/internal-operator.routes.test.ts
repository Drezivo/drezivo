/* Boundary tests intentionally use compact async fakes and inspect untyped HTTP envelopes. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestId } from '../../../middleware/request-id.js';
import { createInternalOperatorRouter, type InternalOperatorService } from '../internal-operator.routes.js';

const grant = { grant_id: '00000000-0000-4000-8000-000000000001', tenant_id: '00000000-0000-4000-8000-000000000002', operator_subject: 'operator-1', permission_codes: ['support.grant.create'], starts_at: '2026-09-19T00:00:00.000Z', expires_at: '2026-09-20T00:00:00.000Z', revoked_at: null, created_at: '2026-09-19T00:00:00.000Z' };
const service: InternalOperatorService = {
  activity: vi.fn(async () => ({ items: [], next_cursor: null })),
  createGrant: vi.fn(async () => grant),
  revokeGrant: vi.fn(async () => ({ ...grant, revoked_at: '2026-09-19T01:00:00.000Z' })),
  retryJob: vi.fn(async () => ({ command_kind: 'job.retry', resource_id: '00000000-0000-4000-8000-000000000003', status: 'accepted', request_id: 'req-1', accepted_at: '2026-09-19T01:00:00.000Z' })),
  retryNotification: vi.fn(async () => ({ command_kind: 'notification.retry', resource_id: '00000000-0000-4000-8000-000000000004', status: 'accepted', request_id: 'req-1', accepted_at: '2026-09-19T01:00:00.000Z' })),
};
function app(options = {}) { const value = express(); value.use(express.json()); value.use(requestId); value.use('/internal/operator/v1', createInternalOperatorRouter({ service, verifyServiceAuth: async () => ({ subject: 'operator-1' }), resolveAuthorization: async () => ({ tenantId: '00000000-0000-4000-8000-000000000002', permissions: ['support.activity.read', 'support.grant.create', 'support.grant.revoke', 'job.retry', 'notification.retry'] }), ...options })); return value; }

describe('internal operator adapter gate', () => {
  beforeEach(() => vi.clearAllMocks());
  it('fails closed with 503 when dependencies are not injected', async () => { const response = await request(express().use(requestId).use('/internal/operator/v1', createInternalOperatorRouter())).get('/internal/operator/v1/support-activity'); expect(response.status).toBe(503); expect(response.body.error.message).toBe('This operator service is temporarily unavailable.'); });
  it('denies an unauthenticated service principal', async () => { const response = await request(app({ verifyServiceAuth: async () => null })).get('/internal/operator/v1/support-activity'); expect(response.status).toBe(401); expect(response.body.error.message).toBe('Operator authorization failed.'); });
  it('rejects malformed input and missing idempotency', async () => { const response = await request(app()).post('/internal/operator/v1/support-grants').send({ tenant_id: 'bad' }); expect(response.status).toBe(422); expect(service.createGrant).not.toHaveBeenCalled(); });
  it('enforces permission and subject boundaries before the service', async () => { const denied = await request(app({ resolveAuthorization: async () => ({ tenantId: '00000000-0000-4000-8000-000000000002', permissions: [] }) })).get('/internal/operator/v1/support-activity'); expect(denied.status).toBe(403); const intent = 'operator-request-1'; const mismatch = await request(app()).post('/internal/operator/v1/jobs/00000000-0000-4000-8000-000000000003/retry').set('Idempotency-Key', intent).send({ reason: 'reconcile', operator_subject: 'other-operator' }); expect(mismatch.status).toBe(404); expect(service.retryJob).not.toHaveBeenCalled(); });
  it('maps all command routes through validated response contracts', async () => { const intent = 'operator-request-1'; const create = await request(app()).post('/internal/operator/v1/support-grants').set('Idempotency-Key', intent).send({ tenant_id: grant.tenant_id, permission_codes: ['support.grant.create'], reason: 'Investigate issue', starts_at: grant.starts_at, expires_at: grant.expires_at, operator_subject: grant.operator_subject }); expect(create.status).toBe(200); expect(create.body.data).toEqual(grant); const revoke = await request(app()).post(`/internal/operator/v1/support-grants/${grant.grant_id}/revoke`).set('Idempotency-Key', intent).send({ operator_subject: 'operator-1' }); expect(revoke.status).toBe(200); const retry = await request(app()).post('/internal/operator/v1/jobs/00000000-0000-4000-8000-000000000003/retry').set('Idempotency-Key', intent).send({ reason: 'reconcile', operator_subject: 'operator-1' }); expect(retry.status).toBe(200); expect(retry.body.data.status).toBe('accepted'); });
  it('conceals foreign scope through the resolver', async () => { const response = await request(app({ resolveAuthorization: async () => null })).post('/internal/operator/v1/jobs/00000000-0000-4000-8000-000000000003/retry').set('Idempotency-Key', 'k').send({ reason: 'reconcile', operator_subject: 'operator-1' }); expect(response.status).toBe(403); expect(service.retryJob).not.toHaveBeenCalled(); });
});
