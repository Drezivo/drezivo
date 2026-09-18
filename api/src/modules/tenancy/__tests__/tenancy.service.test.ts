import { describe, expect, it } from 'vitest';

import { assertTenantAction } from '../tenancy.service.js';
import type { ResolvedActorContext } from '../tenancy.repository.js';

function context(status: 'active' | 'restricted' | 'cancelled'): ResolvedActorContext {
  return {
    effectiveTenantStatus: status,
    activePermissionCodes: [],
    tenant: {} as never,
    membership: {} as never,
    branches: [],
    active_branch_id: '' as never,
    branch_grants: [],
    subscription: {} as never,
    entitlements: {} as never,
  };
}

describe('tenant lifecycle action policy', () => {
  it('allows normal actions for active tenants', () => {
    expect(() => assertTenantAction(context('active'), 'new_booking')).not.toThrow();
  });

  it('keeps only approved operations available when restricted', () => {
    expect(() => assertTenantAction(context('restricted'), 'return')).not.toThrow();
    expect(() => assertTenantAction(context('restricted'), 'new_booking')).toThrowError(
      'temporarily restricted',
    );
  });

  it('keeps settlement and export available after cancellation', () => {
    expect(() => assertTenantAction(context('cancelled'), 'settlement')).not.toThrow();
    expect(() => assertTenantAction(context('cancelled'), 'refund')).toThrowError('closed');
  });
});
