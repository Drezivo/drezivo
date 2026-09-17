import type { OwnerOnboardingRecord } from './onboarding.repository.js';

/** Maps the database-owned onboarding record to the authenticated owner's contract projection. */
export interface PublicOnboarding {
  id: string;
  clerk_org_id: string;
  organization_name: string;
  requested_slug: string | null;
  status: OwnerOnboardingRecord['status'];
  selected_plan_code: OwnerOnboardingRecord['selectedPlanCode'];
  is_trial_eligible: boolean;
  created_at: string;
  updated_at: string;
}

export function toPublicOnboarding(record: OwnerOnboardingRecord): PublicOnboarding {
  return {
    id: record.id,
    clerk_org_id: record.clerkOrgId,
    organization_name: record.organizationName,
    requested_slug: record.requestedSlug,
    status: record.status,
    selected_plan_code: record.selectedPlanCode,
    is_trial_eligible: record.isTrialEligible,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export interface OwnerOnboardingContextDTO {
  onboarding: PublicOnboarding | null;
  has_current_owned_tenant: boolean;
  has_consumed_lifetime_trial: boolean;
}
