import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { createHash } from 'node:crypto';

import { config } from '../../config/index.js';
import { withSystemGlobalTransaction } from '../../db/client.js';
import {
  insertClerkWebhookInbox,
  type InsertWebhookInboxResult,
} from './webhook-inbox.repository.js';
import { normalizeClerkWebhookEvent } from './clerk.schemas.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { RateLimitedError, ValidationError } from '../../shared/errors.js';
import { sendError } from '../../shared/response.js';

export interface ClerkWebhookVerifierOptions {
  signingSecret: string;
}

export type ClerkWebhookVerifier = (
  request: Request,
  options: ClerkWebhookVerifierOptions,
) => Promise<unknown>;

export interface ClerkWebhookRouterDependencies {
  signingSecret: string;
  verify?: ClerkWebhookVerifier;
  ingest?: (input: {
    providerEventId: string;
    eventType: Parameters<typeof insertClerkWebhookInbox>[1]['eventType'];
    payloadDigest: string;
    safePayload: Record<string, unknown>;
  }) => Promise<InsertWebhookInboxResult>;
}

const genericRejectionMessage = 'Webhook request could not be accepted.';

function reject(req: Request, res: Response): void {
  sendError(res, 422, 'VALIDATION_FAILED', genericRejectionMessage, req.requestId);
}

function defaultVerify(request: Request, options: ClerkWebhookVerifierOptions): Promise<unknown> {
  return verifyWebhook(request, options);
}

function defaultIngest(
  input: Parameters<NonNullable<ClerkWebhookRouterDependencies['ingest']>>[0],
): Promise<InsertWebhookInboxResult> {
  return withSystemGlobalTransaction('clerk:webhook', (client) =>
    insertClerkWebhookInbox(client, input),
  );
}

/**
 * The provider boundary is deliberately a raw-body route. It is mounted before the application's
 * JSON parser so Clerk/Svix verifies the exact bytes that arrived on the wire, while the only
 * persisted representation is the normalized, redacted inbox projection.
 */
export function createClerkWebhookRouter(dependencies: ClerkWebhookRouterDependencies): Router {
  const router = Router();
  const verifier = dependencies.verify ?? defaultVerify;
  const ingest = dependencies.ingest ?? defaultIngest;

  router.post(
    '/webhooks/clerk',
    rateLimit({ windowMs: 60_000, max: 60, keyOf: (req) => req.ip || 'unknown' }),
    (req, res, next) => {
      if (!req.is('application/json')) {
        reject(req, res);
        return;
      }
      next();
    },
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res, next) => {
      if (!Buffer.isBuffer(req.body)) {
        reject(req, res);
        return;
      }

      const providerEventId = req.get('svix-id')?.trim();
      if (!providerEventId || providerEventId.length > 255) {
        reject(req, res);
        return;
      }

      let event: unknown;
      try {
        event = await verifier(req, { signingSecret: dependencies.signingSecret });
      } catch {
        // Signature, timestamp, and missing-header failures are deliberately indistinguishable.
        reject(req, res);
        return;
      }

      let normalized;
      try {
        normalized = normalizeClerkWebhookEvent(event);
      } catch (error) {
        if (error instanceof ValidationError) {
          reject(req, res);
          return;
        }
        next(error);
        return;
      }
      if (normalized.kind === 'ignored') {
        res.status(204).end();
        return;
      }

      const payloadDigest = createHash('sha256').update(req.body).digest('hex');
      await ingest({
        providerEventId,
        eventType: normalized.event.eventType,
        payloadDigest,
        safePayload: normalized.event.safePayload,
      });
      // A provider retry is intentionally indistinguishable from a new accepted event.
      res.status(204).end();
    },
  );

  // express.raw can reject an oversized body before the async handler runs. Do not expose the
  // parser/verifier distinction to a provider; rate-limit errors retain the standard 429 path.
  router.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof RateLimitedError) {
      next(error);
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      typeof (error as { type?: unknown }).type === 'string'
    ) {
      reject(req, res);
      return;
    }
    next(error);
  });

  return router;
}

export const clerkWebhookRouter = createClerkWebhookRouter({
  signingSecret: config.CLERK_WEBHOOK_SIGNING_SECRET,
});
