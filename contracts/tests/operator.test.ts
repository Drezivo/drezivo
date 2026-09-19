import { describe, expect, it } from 'vitest';
import {
  createSupportGrantRequest,
  operatorActivityQuery,
  retryCommandRequest,
} from '../src';

const tenant = '00000000-0000-4000-8000-000000000001';

describe('operator contracts', () => {
  it('rejects an unbounded or reversed activity window', () => {
    expect(operatorActivityQuery.safeParse({ tenant_id: tenant, limit: 101 }).success).toBe(false);
  });

  it('requires a bounded grant and validates its time window', () => {
    expect(createSupportGrantRequest.safeParse({ tenant_id: tenant, permission_codes: ['tenant.read'], reason: 'support reason', starts_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z' }).success).toBe(true);
    expect(createSupportGrantRequest.safeParse({ tenant_id: tenant, permission_codes: [], reason: 'support reason', starts_at: '2026-01-02T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' }).success).toBe(false);
  });

  it('rejects unknown retry fields and malformed ids', () => {
    expect(retryCommandRequest.safeParse({ reason: 'retry reason', extra: true }).success).toBe(false);
  });
});
