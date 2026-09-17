import { z } from 'zod';

import {
  membershipId,
  membershipInvitationId,
  operatorActionId,
  organizationOnboardingId,
  subscriptionId,
} from '../common/ids';
import { moneyAmount } from '../common/money';
import { isoInstant } from '../common/time';

/** Global pre-tenant lifecycle, owned by Drezivo rather than Clerk. */
export const onboardingStatus = z.enum(['incomplete', 'abandoned', 'payment_pending', 'provisioned']);
export type OnboardingStatus = z.infer<typeof onboardingStatus>;

export const planCode = z.enum(['starter', 'professional', 'business']);
export type PlanCode = z.infer<typeof planCode>;

export const subscriptionStatus = z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

export const membershipInvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type MembershipInvitationStatus = z.infer<typeof membershipInvitationStatus>;

export const clerkWebhookEventType = z.enum([
  'organization.created',
  'organization.updated',
  'organization.deleted',
  'organization_invitation.created',
  'organization_invitation.accepted',
  'organization_invitation.revoked',
  'organization_membership.created',
  'organization_membership.updated',
  'organization_membership.deleted',
]);
export type ClerkWebhookEventType = z.infer<typeof clerkWebhookEventType>;

const organizationName = z.string().trim().min(1).max(160);
const organizationSlug = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and single hyphens.');
export const onboardingAbandonReasonCode = z.enum([
  'not_now',
  'wrong_details',
  'payment_concern',
  'other',
]);
export type OnboardingAbandonReasonCode = z.infer<typeof onboardingAbandonReasonCode>;
const safeReason = z.string().trim().min(1).max(500);
const safeReference = z.string().trim().min(1).max(200);

/** Authenticated-owner projection. The Clerk organization ID is opaque, not a secret. */
export const organizationOnboarding = z.object({
  id: organizationOnboardingId,
  clerk_org_id: z.string().trim().min(1).max(200),
  organization_name: organizationName,
  requested_slug: organizationSlug.nullable(),
  status: onboardingStatus,
  selected_plan_code: planCode.nullable(),
  is_trial_eligible: z.boolean(),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type OrganizationOnboarding = z.infer<typeof organizationOnboarding>;

export const onboardingActorContext = z.object({
  onboarding: organizationOnboarding.nullable(),
  has_current_owned_tenant: z.boolean(),
  has_consumed_lifetime_trial: z.boolean(),
});
export type OnboardingActorContext = z.infer<typeof onboardingActorContext>;

export const membershipInvitation = z.object({
  id: membershipInvitationId,
  status: membershipInvitationStatus,
  expires_at: isoInstant,
  created_at: isoInstant,
});
export type MembershipInvitation = z.infer<typeof membershipInvitation>;

export const subscriptionSummary = z.object({
  id: subscriptionId,
  plan_code: planCode,
  status: subscriptionStatus,
  trial_ends_at: isoInstant.nullable(),
  grace_ends_at: isoInstant.nullable(),
});
export type SubscriptionSummary = z.infer<typeof subscriptionSummary>;

export const operatorActionStatus = z.enum(['accepted', 'rejected', 'completed']);
export type OperatorActionStatus = z.infer<typeof operatorActionStatus>;

export const operatorActionResponse = z.object({
  action_id: operatorActionId,
  status: operatorActionStatus,
  recorded_at: isoInstant,
});
export type OperatorActionResponse = z.infer<typeof operatorActionResponse>;

/** Projected inbox metadata, never Clerk's raw signed payload. */
export const clerkWebhookInboxRecord = z.object({
  provider: z.literal('clerk'),
  provider_event_id: z.string().min(1).max(255),
  event_type: clerkWebhookEventType,
  received_at: isoInstant,
});
export type ClerkWebhookInboxRecord = z.infer<typeof clerkWebhookInboxRecord>;

export const createOwnerOnboardingRequest = z
  .object({ organization_name: organizationName, slug: organizationSlug.optional() })
  .strict();
export type CreateOwnerOnboardingRequest = z.infer<typeof createOwnerOnboardingRequest>;

export const resumeOwnerOnboardingRequest = z.object({}).strict();
export type ResumeOwnerOnboardingRequest = z.infer<typeof resumeOwnerOnboardingRequest>;

export const abandonOwnerOnboardingRequest = z
  .object({ reason_code: onboardingAbandonReasonCode })
  .strict();
export type AbandonOwnerOnboardingRequest = z.infer<typeof abandonOwnerOnboardingRequest>;

export const chooseOnboardingPlanRequest = z.object({ plan_code: planCode }).strict();
export type ChooseOnboardingPlanRequest = z.infer<typeof chooseOnboardingPlanRequest>;

export const bootstrapTenantRequest = z.object({}).strict();
export type BootstrapTenantRequest = z.infer<typeof bootstrapTenantRequest>;

export const createMembershipInvitationRequest = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();
export type CreateMembershipInvitationRequest = z.infer<typeof createMembershipInvitationRequest>;

export const membershipInvitationParams = z.object({ invitation_id: membershipInvitationId }).strict();
export type MembershipInvitationParams = z.infer<typeof membershipInvitationParams>;

export const resendMembershipInvitationRequest = z.object({}).strict();
export type ResendMembershipInvitationRequest = z.infer<typeof resendMembershipInvitationRequest>;

export const cancelMembershipInvitationRequest = z.object({}).strict();
export type CancelMembershipInvitationRequest = z.infer<typeof cancelMembershipInvitationRequest>;

export const claimMembershipInvitationRequest = z.object({}).strict();
export type ClaimMembershipInvitationRequest = z.infer<typeof claimMembershipInvitationRequest>;

export const changeSubscriptionPlanRequest = z.object({ plan_code: planCode }).strict();
export type ChangeSubscriptionPlanRequest = z.infer<typeof changeSubscriptionPlanRequest>;

export const verifyOnboardingPaymentRequest = z
  .object({
    onboarding_id: organizationOnboardingId,
    amount: moneyAmount,
    payment_reference: safeReference,
  })
  .strict();
export type VerifyOnboardingPaymentRequest = z.infer<typeof verifyOnboardingPaymentRequest>;

export const closeTenantRequest = z.object({ reason: safeReason }).strict();
export type CloseTenantRequest = z.infer<typeof closeTenantRequest>;

export const transferOwnershipRequest = z
  .object({
    successor_membership_id: membershipId,
    reason: safeReason,
    evidence_reference: safeReference,
  })
  .strict();
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequest>;
