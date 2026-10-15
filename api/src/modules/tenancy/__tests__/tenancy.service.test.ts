import { describe, expect, it } from 'vitest';

import { assertTenantAction, requirePlanFeature } from '../tenancy.service.js';
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
    access: {} as never,
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

describe('plan feature route guard', () => {
  it('rejects direct requests when a feature is not in the resolved plan entitlements', () => {
    let forwardedError: unknown;
    const guard = requirePlanFeature('fittings');
    guard(
      {
        tenantContext: {
          actorContext: { entitlements: { features: { fittings: false } } },
        },
      } as never,
      {} as never,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toMatchObject({ code: 'STATE_CONFLICT', status: 409 });
  });

  it('fails closed when entitlement context is missing', () => {
    let forwardedError: unknown;
    const guard = requirePlanFeature('storefront_reservations');
    guard({} as never, {} as never, (error?: unknown) => {
      forwardedError = error;
    });

    expect(forwardedError).toMatchObject({ code: 'STATE_CONFLICT', status: 409 });
  });
});
