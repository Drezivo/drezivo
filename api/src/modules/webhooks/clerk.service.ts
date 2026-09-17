import { createHash } from 'node:crypto';

import { ValidationError } from '../../shared/errors.js';
import {
  persistClerkWebhookInbox,
  type InsertWebhookInboxResult,
  type InsertWebhookInboxInput,
} from './webhook-inbox.repository.js';
import { normalizeClerkWebhookEvent } from './clerk.schemas.js';

export interface ClerkWebhookServiceDependencies {
  ingest?: (input: InsertWebhookInboxInput) => Promise<InsertWebhookInboxResult>;
}

const genericRejectionMessage = 'Webhook request could not be accepted.';

export interface ClerkWebhookService {
  accept(input: {
    rawBody: Buffer;
    providerEventId: string;
    verify: () => Promise<unknown>;
  }): Promise<void>;
}

export function createClerkWebhookService(
  dependencies: ClerkWebhookServiceDependencies,
): ClerkWebhookService {
  const ingest = dependencies.ingest ?? persistClerkWebhookInbox;

  return {
    async accept(input): Promise<void> {
      if (!Buffer.isBuffer(input.rawBody)) {
        throw new ValidationError(genericRejectionMessage);
      }

      if (!input.providerEventId || input.providerEventId.length > 255) {
        throw new ValidationError(genericRejectionMessage);
      }

      let event: unknown;
      try {
        event = await input.verify();
      } catch {
        throw new ValidationError(genericRejectionMessage);
      }

      let normalized;
      try {
        normalized = normalizeClerkWebhookEvent(event);
      } catch {
        throw new ValidationError(genericRejectionMessage);
      }
      if (normalized.kind === 'ignored') {
        return;
      }

      const payloadDigest = createHash('sha256').update(input.rawBody).digest('hex');
      await ingest({
        providerEventId: input.providerEventId,
        eventType: normalized.event.eventType,
        payloadDigest,
        safePayload: normalized.event.safePayload,
      });
    },
  };
}
