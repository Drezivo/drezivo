import { describe, expect, it } from 'vitest';

import type { SubscriptionAccess } from '@drezivo/contracts';

import { assertSubscriptionAccess } from '../access-gate.js';

const access = (level: SubscriptionAccess['level']): SubscriptionAccess => ({
  level,
  reason: level === 'full' ? 'paid' : 'payment_overdue',
  ends_at: null,
  days_left: null,
  pending_payment: false,
  storefront_online: level !== 'locked',
  storefront_offline_at: null,
  read_only_until: null,
});
const req = (method: string, path: string, body: unknown = {}) => ({ method, path, body });
const FILE = '0b5b9f0e-6a4f-4b8a-9d38-2f0b8f7f6c11';

describe('subscription access gate', () => {
  it('lets a full workspace do anything', () => {
    expect(() => assertSubscriptionAccess(req('POST', '/api/v1/reservations'), access('full'))).not.toThrow();
  });

  it('keeps a view-only workspace to reads, paying, and its proof upload', () => {
    const readOnly = access('read_only');
    expect(() => assertSubscriptionAccess(req('GET', '/api/v1/reservations'), readOnly)).not.toThrow();
    expect(() => assertSubscriptionAccess(req('POST', '/api/v1/billing/payments'), readOnly)).not.toThrow();
    expect(() => assertSubscriptionAccess(req('POST', '/api/v1/uploads', { purpose: 'subscription_payment_proof' }), readOnly)).not.toThrow();
    expect(() => assertSubscriptionAccess(req('POST', `/api/v1/uploads/${FILE}/finalize`), readOnly)).not.toThrow();

    expect(() => assertSubscriptionAccess(req('POST', '/api/v1/reservations'), readOnly)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_READ_ONLY', status: 403 }));
    expect(() => assertSubscriptionAccess(req('PATCH', '/api/v1/storefront'), readOnly)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_READ_ONLY' }));
    expect(() => assertSubscriptionAccess(req('POST', '/api/v1/uploads', { purpose: 'catalogue_image' }), readOnly)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_READ_ONLY' }));
  });

  it('keeps a locked workspace to the context, billing, and paying', () => {
    const locked = access('locked');
    for (const allowed of [req('GET', '/api/v1/actor-context'), req('GET', '/api/v1/billing'), req('GET', `/api/v1/billing/payment-methods/${FILE}/qr`), req('POST', '/api/v1/billing/payments'), req('POST', '/api/v1/uploads', { purpose: 'subscription_payment_proof' })]) {
      expect(() => assertSubscriptionAccess(allowed, locked)).not.toThrow();
    }
    expect(() => assertSubscriptionAccess(req('GET', '/api/v1/reservations'), locked)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_LOCKED', status: 403 }));
    expect(() => assertSubscriptionAccess(req('GET', '/api/v1/billing/payments/extra'), locked)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_LOCKED' }));
  });
});
