import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn(), warn: vi.fn() }));
vi.mock('../operator-proof-link.js', () => ({ verifyProofLink: mocks.verify }));
vi.mock('../billing-payments.service.js', () => ({
  getBillingOverview: vi.fn(), readPlatformQr: vi.fn(), submitSubscriptionPayment: vi.fn(), readPaymentProof: mocks.read,
}));
vi.mock('../../../shared/logger.js', () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { billingRouter } from '../billing.routes.js';

function app() {
  const server = express();
  server.use((req, _res, next) => { req.requestId = 'request-id'; next(); });
  server.use('/api/v1', billingRouter);
  return server;
}

describe('operator proof route diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs invalid links without recording the token', async () => {
    mocks.verify.mockReturnValue(null);
    const response = await request(app()).get('/api/v1/operator/payment-proofs/private-token');
    expect(response.status).toBe(404);
    expect(response.headers['x-drezivo-proof-route']).toBe('v1');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'request-id', reason: 'invalid_or_expired_link' }), expect.any(String));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private-token');
  });

  it('passes the verified tenant and payment and request ID to the reader', async () => {
    mocks.verify.mockReturnValue({ tenantId: 'tenant', paymentId: 'payment' });
    mocks.read.mockResolvedValue(null);
    const response = await request(app()).get('/api/v1/operator/payment-proofs/private-token');
    expect(response.status).toBe(404);
    expect(response.headers['x-drezivo-proof-route']).toBe('v1');
    expect(mocks.read).toHaveBeenCalledWith('tenant', 'payment', 'proof-link', undefined, 'request-id');
  });
});
