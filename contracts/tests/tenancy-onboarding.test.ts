import { describe, expect, it } from 'vitest';

import {
  clerkWebhookEventType,
  createMembershipInvitationRequest,
  createOwnerOnboardingRequest,
  abandonOwnerOnboardingRequest,
  membershipInvitationStatus,
  onboardingStatus,
  organizationOnboarding,
  planCode,
  subscriptionStatus,
  transferOwnershipRequest,
} from '../src/tenancy/onboarding';

describe('tenancy onboarding contracts', () => {
  it('accepts the approved lifecycle states and rejects unknown ones', () => {
    for (const status of ['incomplete', 'abandoned', 'payment_pending', 'provisioned']) {
      expect(onboardingStatus.safeParse(status).success).toBe(true);
    }
    expect(onboardingStatus.safeParse('started').success).toBe(false);
    expect(planCode.safeParse('starter').success).toBe(true);
    expect(planCode.safeParse('enterprise').success).toBe(false);
    expect(subscriptionStatus.safeParse('restricted').success).toBe(true);
    expect(membershipInvitationStatus.safeParse('pending').success).toBe(true);
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
        tenant_id: '41bf891f-cab6-48a9-a965-e84deea05df6',
      }).success,
    ).toBe(false);
  });

  it('requires structured abandonment reasons and returns the opaque Clerk organization ID', () => {
    expect(abandonOwnerOnboardingRequest.safeParse({ reason_code: 'payment_concern' }).success).toBe(
      true,
    );
    expect(abandonOwnerOnboardingRequest.safeParse({ reason: 'free text' }).success).toBe(false);
    expect(
      organizationOnboarding.safeParse({
        id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
        clerk_org_id: 'org_123',
        organization_name: 'Drezivo Formalwear',
        requested_slug: null,
        status: 'incomplete',
        selected_plan_code: null,
        is_trial_eligible: true,
        created_at: '2026-09-17T00:00:00.000Z',
        updated_at: '2026-09-17T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
