import { z } from 'zod';

import {
  abandonOwnerOnboardingRequest,
  createOwnerOnboardingRequest,
  bootstrapTenantRequest,
  organizationOnboardingId,
} from '@drezivo/contracts';

export { abandonOwnerOnboardingRequest, bootstrapTenantRequest, createOwnerOnboardingRequest };
type ContractCreateOwnerOnboardingInput = z.infer<typeof createOwnerOnboardingRequest>;
type ContractAbandonOwnerOnboardingInput = z.infer<typeof abandonOwnerOnboardingRequest>;

// The checked-in contracts source includes these fields. The local package declaration can lag
// until the contracts build is published, so keep the boundary type compatible with both forms.
export type CreateOwnerOnboardingInput = ContractCreateOwnerOnboardingInput & { slug?: string };
export type AbandonOwnerOnboardingInput = Omit<ContractAbandonOwnerOnboardingInput, 'reason'> & {
  reason_code: 'not_now' | 'wrong_details' | 'payment_concern' | 'other';
};
export type BootstrapTenantInput = z.infer<typeof bootstrapTenantRequest>;

export const ownerOnboardingIdParams = z.object({ onboardingId: organizationOnboardingId }).strict();
export type OwnerOnboardingIdParams = z.infer<typeof ownerOnboardingIdParams>;
