import type { PoolClient } from 'pg';

import { withGlobalTransaction } from '../../db/client.js';
import {
  appendGlobalAuditEvent,
  type AppendGlobalAuditEventInput,
} from '../audit/global-audit.repository.js';
import {
  claimBootstrapIdempotency,
  finalizeBootstrapIdempotency,
  type BootstrapIdempotencyClaim,
  type FinalizeBootstrapIdempotencyInput,
} from '../bootstrap/bootstrap.repository.js';
import type { AccountRecord } from '../accounts/account.repository.js';
import {
  abandonOnboardingInTransaction,
  createOrResumeOnboardingInTransaction,
  type AbandonOnboardingResult,
  type CreateOrResumeOnboardingResult,
} from './onboarding.repository.js';
import {
  claimOwnerOnboardingStart,
  markOwnerAttemptFailed,
  markOwnerAttemptLocalPersisted,
  markOwnerAttemptProviderCreated,
  type OwnerOnboardingStartClaim,
} from './onboarding-attempt.repository.js';

export interface OnboardingTransaction {
  claimStart(input: {
    account: AccountRecord;
    operation: string;
    intentKey: string;
    payloadHash: string;
    organizationName: string;
    requestedSlug: string | null;
  }): Promise<OwnerOnboardingStartClaim>;
  createOrResume(input: {
    accountId: string;
    clerkOrgId: string;
    principalId: string;
    organizationName: string;
    requestedSlug: string | null;
  }): Promise<CreateOrResumeOnboardingResult>;
  abandon(input: { onboardingId: string; principalId: string }): Promise<AbandonOnboardingResult>;
  markAttemptProviderCreated(attemptId: string, providerOrgId: string): Promise<void>;
  markAttemptLocalPersisted(attemptId: string): Promise<void>;
  markAttemptFailed(attemptId: string): Promise<void>;
  appendAudit(input: AppendGlobalAuditEventInput): Promise<void>;
  finalizeIdempotency(input: FinalizeBootstrapIdempotencyInput): Promise<void>;
}

/**
 * Repository-level transaction coordinator for onboarding workflows. Services use the typed
 * persistence operations below and never receive a PoolClient or issue SQL themselves.
 */
export async function withOnboardingTransaction<T>(
  principalId: string,
  fn: (transaction: OnboardingTransaction) => Promise<T>,
): Promise<T> {
  return withGlobalTransaction(principalId, async (client) => fn(createTransaction(client)));
}

function createTransaction(client: PoolClient): OnboardingTransaction {
  return {
    claimStart: (input) => claimOwnerOnboardingStart(client, input),
    createOrResume: (input) =>
      createOrResumeOnboardingInTransaction(
        client,
        input.accountId,
        input.clerkOrgId,
        input.principalId,
        {
          organizationName: input.organizationName,
          requestedSlug: input.requestedSlug,
        },
      ),
    abandon: (input) => abandonOnboardingInTransaction(client, input.onboardingId, input.principalId),
    markAttemptProviderCreated: (attemptId, providerOrgId) =>
      markOwnerAttemptProviderCreated(client, attemptId, providerOrgId),
    markAttemptLocalPersisted: (attemptId) => markOwnerAttemptLocalPersisted(client, attemptId),
    markAttemptFailed: (attemptId) => markOwnerAttemptFailed(client, attemptId),
    appendAudit: async (input) => {
      await appendGlobalAuditEvent(client, input);
    },
    finalizeIdempotency: async (input) => {
      await finalizeBootstrapIdempotency(client, input);
    },
  };
}

export type { BootstrapIdempotencyClaim };

export async function claimBootstrapRecord(
  principalId: string,
  input: Parameters<typeof claimBootstrapIdempotency>[1],
): Promise<BootstrapIdempotencyClaim> {
  return withGlobalTransaction(principalId, (client) => claimBootstrapIdempotency(client, input));
}
