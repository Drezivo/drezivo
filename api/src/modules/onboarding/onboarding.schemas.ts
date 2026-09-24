import { z } from 'zod';

import {
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  chooseOnboardingPlanRequest,
  createOwnerOnboardingRequest,
  organizationOnboardingId,
} from '@drezivo/contracts';

export {
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  chooseOnboardingPlanRequest,
  createOwnerOnboardingRequest,
};
type ContractAbandonOwnerOnboardingInput = z.infer<typeof abandonOwnerOnboardingRequest>;

export type CreateOwnerOnboardingInput = z.infer<typeof createOwnerOnboardingRequest>;
export type AbandonOwnerOnboardingInput = Omit<ContractAbandonOwnerOnboardingInput, 'reason'> & {
  reason_code: 'not_now' | 'wrong_details' | 'payment_concern' | 'other';
};
export type BootstrapTenantInput = z.infer<typeof bootstrapTenantRequest>;
export type ChooseOnboardingPlanInput = z.infer<typeof chooseOnboardingPlanRequest>;

export const ownerOnboardingIdParams = z.object({ onboardingId: organizationOnboardingId }).strict();
export type OwnerOnboardingIdParams = z.infer<typeof ownerOnboardingIdParams>;
