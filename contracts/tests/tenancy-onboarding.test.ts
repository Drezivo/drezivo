import { describe, expect, it } from 'vitest';

import {
  clerkWebhookEventType,
  createMembershipInvitationRequest,
  createOwnerOnboardingRequest,
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  claimMembershipInvitationRequest,
  membershipInvitationStatus,
  membershipInvitationList,
  memberRosterResponse,
  onboardingStatus,
  organizationOnboarding,
  planCode,
  publicPlanCatalogResponse,
  subscriptionStatus,
  tenantBootstrapResponse,
  transferOwnershipRequest,
} from '../src/tenancy/onboarding';

describe('tenancy onboarding contracts', () => {
  it('accepts the approved lifecycle states and rejects unknown ones', () => {
    for (const status of ['incomplete', 'abandoned', 'payment_pending', 'provisioned']) {
      expect(onboardingStatus.safeParse(status).success).toBe(true);
    }
    expect(onboardingStatus.safeParse('started').success).toBe(false);
    expect(planCode.safeParse('starter').success).toBe(true);
    expect(planCode.safeParse('standard').success).toBe(true);
    expect(planCode.safeParse('professional').success).toBe(false);
    expect(planCode.safeParse('enterprise').success).toBe(false);
    expect(subscriptionStatus.safeParse('restricted').success).toBe(true);
    expect(membershipInvitationStatus.safeParse('pending').success).toBe(true);
  });

  it('validates public plan prices and server-owned limits', () => {
    const starterPlan = {
      code: 'starter',
      name: 'Starter',
      monthly_price_minor: 14900,
      currency: 'PHP',
      trial_days: 14,
      limits: { active_garments: 125, frontdesk_seats: 0 },
    };
    const catalog = {
      plans: [
        starterPlan,
        {
          code: 'standard',
          name: 'Standard',
          monthly_price_minor: 29900,
          currency: 'PHP',
          trial_days: 14,
          limits: { active_garments: 300, frontdesk_seats: 3 },
        },
      ],
    };
    expect(publicPlanCatalogResponse.safeParse(catalog).success).toBe(true);
    expect(
      publicPlanCatalogResponse.safeParse({ plans: [{ ...catalog.plans[0], monthly_price_minor: 0 }] })
        .success,
    ).toBe(false);
    expect(
      publicPlanCatalogResponse.safeParse({
        plans: [{ ...starterPlan, limits: { ...starterPlan.limits, extra: 1 } }],
      }).success,
    ).toBe(false);
  });

  it('allows only the Clerk organization event families Drezivo reconciles', () => {
    expect(clerkWebhookEventType.safeParse('organization_membership.created').success).toBe(true);
    expect(clerkWebhookEventType.safeParse('user.created').success).toBe(false);
  });

  it('rejects client-supplied tenant, role, and entitlement authority', () => {
    expect(
      createOwnerOnboardingRequest.safeParse({
        organization_name: 'Drezivo Formalwear',
        tenant_id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
      }).success,
    ).toBe(false);
    expect(
      createOwnerOnboardingRequest.safeParse({
        organization_name: 'Drezivo Formalwear',
        slug: 'drezivo-formalwear',
      }).success,
    ).toBe(false);
    expect(
      createMembershipInvitationRequest.safeParse({
        email: 'frontdesk@example.test',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(
      transferOwnershipRequest.safeParse({
        successor_membership_id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
        reason: 'Verified business handover',
        evidence_reference: 'case-123',
        tenant_id: '41bf891f-481b-47fd-a24e-6208f44e62ad',
      }).success,
    ).toBe(false);
  });

  it('requires structured abandonment reasons and returns the opaque Clerk organization ID', () => {
    expect(abandonOwnerOnboardingRequest.safeParse({ reason_code: 'payment_concern' }).success).toBe(true);
    expect(abandonOwnerOnboardingRequest.safeParse({ reason: 'free text' }).success).toBe(false);
    expect(
      organizationOnboarding.safeParse({
        id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
        clerk_org_id: 'org_123',
        organization_name: 'Drezivo Formalwear',
        status: 'incomplete',
        selected_plan_code: null,
        is_trial_eligible: true,
        created_at: '2026-09-17T00:00:00.000Z',
        updated_at: '2026-09-17T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('models the strict bootstrap command and complete safe response projection', () => {
    expect(bootstrapTenantRequest.safeParse({}).success).toBe(true);
    expect(bootstrapTenantRequest.safeParse({ plan_code: 'starter' }).success).toBe(false);
    expect(
      tenantBootstrapResponse.safeParse({
        tenant: {
          id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
          name: 'Drezivo Formalwear',
          slug: 'drezivo-formalwear',
          status: 'active',
          currency: 'PHP',
          timezone: 'Asia/Manila',
          created_at: '2026-09-17T00:00:00.000Z',
          updated_at: '2026-09-17T00:00:00.000Z',
        },
        default_branch: {
          id: '2b8d2ea5-d2ee-4f77-9f4e-7a8a4e3d0f3e',
          name: 'Main Branch',
          code: 'main',
          is_default: true,
          timezone: 'Asia/Manila',
          status: 'active',
        },
        membership: {
          id: 'bd6e4f50-93ff-4a2f-8d41-9e06f1af9b8e',
          role: 'owner',
          status: 'active',
          updated_at: '2026-09-17T00:00:00.000Z',
        },
        branch_grants: [
          {
            branch_id: '2b8d2ea5-d2ee-4f77-9f4e-7a8a4e3d0f3e',
            permission_codes: ['assets.manage'],
          },
        ],
        subscription: {
          id: 'f0dc85c4-4b31-47fd-a24e-6208f44e62ad',
          plan_code: 'starter',
          status: 'trialing',
          trial_ends_at: '2026-09-24T00:00:00.000Z',
          grace_ends_at: null,
        },
      }).success,
    ).toBe(true);
  });

  it('keeps invitation claim intentionally empty and server-authorized', () => {
    expect(claimMembershipInvitationRequest.safeParse({}).success).toBe(true);
    expect(claimMembershipInvitationRequest.safeParse({ tenant_id: 'nope' }).success).toBe(false);
  });

  it('models the owner-only member roster and invitation recipient projection', () => {
    expect(
      memberRosterResponse.safeParse({
        members: [
          {
            id: 'bd6e4f50-93ff-4a2f-8d41-9e06f1af9b8e',
            name: 'Business Owner',
            email: 'owner@example.test',
            role: 'owner',
          },
          {
            id: 'de89a4a1-f781-467c-8cad-027fe1ee8b15',
            name: null,
            email: null,
            role: 'frontdesk',
          },
        ],
        frontdesk_seats: { used: 1, max: 10 },
      }).success,
    ).toBe(true);
    expect(
      memberRosterResponse.safeParse({
        members: [],
        frontdesk_seats: { used: -1, max: 10 },
      }).success,
    ).toBe(false);

    const invitation = {
      id: '9fbd891f-481b-47fd-a24e-6208f44e62ad',
      email: 'frontdesk@example.test',
      status: 'pending',
      expires_at: '2026-10-12T00:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z',
    };
    expect(
      membershipInvitationList.safeParse({
        items: [invitation],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(true);
    expect(
      membershipInvitationList.safeParse({
        items: [{ ...invitation, email: undefined }],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(false);
  });
});
