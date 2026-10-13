import {
  CURRENT_TERMS_VERSION,
  type TermsAcceptanceRequest,
  type TermsAcceptanceResponse,
} from '@drezivo/contracts';

import { withGlobalTransaction } from '../../db/client.js';
import {
  appendGlobalAuditEvent,
} from '../audit/global-audit.repository.js';
import {
  claimBootstrapIdempotency,
  finalizeBootstrapIdempotency,
} from '../bootstrap/bootstrap.repository.js';
import { ensureAccount } from './account.repository.js';
import {
  getAccountTermsAcceptance,
  insertAccountTermsAcceptance,
  lockAccountForTermsAcceptance,
} from './terms-acceptance.repository.js';
import {
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { SuccessEnvelope } from '../../shared/response.js';

const TERMS_ACCEPTANCE_OPERATION = 'account.terms.accept';

export async function acceptCurrentAccountTerms(input: {
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  request: TermsAcceptanceRequest;
}): Promise<SuccessEnvelope<TermsAcceptanceResponse>> {
  if (input.request.terms_version !== CURRENT_TERMS_VERSION) {
    throw new StateConflictError('Review and accept the current Terms of Service before continuing.');
  }

  const account = await ensureAccount(input.principalId);
  const payloadHash = canonicalRequestHash(input.request);

  return withGlobalTransaction(input.principalId, async (client) => {
    if (!(await lockAccountForTermsAcceptance(client, account.id, input.principalId))) {
      throw new NotFoundError('Account could not be found.');
    }

    const claim = await claimBootstrapIdempotency(client, {
      accountId: account.id,
      operation: TERMS_ACCEPTANCE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') {
      return claim.safeResponse as SuccessEnvelope<TermsAcceptanceResponse>;
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError(
        'This Idempotency-Key was already used for another request.',
      );
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError('An identical Terms acceptance is still being recorded. Retry shortly.');
    }

    let acceptance = await getAccountTermsAcceptance(client, account.id, CURRENT_TERMS_VERSION);
    if (!acceptance) {
      acceptance = await insertAccountTermsAcceptance(client, account.id, CURRENT_TERMS_VERSION);
      if (acceptance) {
        await appendGlobalAuditEvent(client, {
          accountId: account.id,
          actorKind: 'account',
          actorKey: input.principalId,
          action: 'account.terms.accepted',
          entityType: 'account_terms_acceptance',
          outcome: 'succeeded',
          redactedSummary: { terms_version: CURRENT_TERMS_VERSION, source: 'onboarding' },
          requestId: input.requestId,
        });
      } else {
        // The account row lock serializes this account. This fallback remains fail-closed if a
        // future writer bypasses that convention but wins the immutable version key.
        acceptance = await getAccountTermsAcceptance(client, account.id, CURRENT_TERMS_VERSION);
      }
    }
    if (!acceptance) {
      throw new StateConflictError('We could not save your Terms acceptance. Please retry.');
    }

    const body: SuccessEnvelope<TermsAcceptanceResponse> = {
      success: true,
      data: {
        terms_version: acceptance.termsVersion as typeof CURRENT_TERMS_VERSION,
        accepted_at: acceptance.acceptedAt.toISOString(),
      },
      request_id: input.requestId,
    };
    await finalizeBootstrapIdempotency(client, {
      accountId: account.id,
      operation: TERMS_ACCEPTANCE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      recordId: claim.recordId,
      status: 'succeeded',
      responseCode: 200,
      safeResponse: body,
    });
    return body;
  });
}
