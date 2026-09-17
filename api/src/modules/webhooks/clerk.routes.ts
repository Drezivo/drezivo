import express, { Router } from 'express';

import { config } from '../../config/index.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { createClerkWebhookController } from './clerk.controller.js';
import { handleClerkRawBodyError, requireClerkJsonContentType } from './clerk.middleware.js';
import {
  createClerkWebhookService,
  type ClerkWebhookServiceDependencies,
} from './clerk.service.js';
import { verifyClerkWebhook, type ClerkWebhookVerifier, type ClerkWebhookVerifierOptions } from './clerk.verifier.js';

export interface ClerkWebhookRouterDependencies extends ClerkWebhookServiceDependencies {
  signingSecret: string;
  verify?: ClerkWebhookVerifier;
}
export type { ClerkWebhookVerifier, ClerkWebhookVerifierOptions };

/** Declares the raw, rate-limited webhook boundary; verification and ingestion live in the service. */
export function createClerkWebhookRouter(dependencies: ClerkWebhookRouterDependencies): Router {
  const router = Router();
  const serviceDependencies: ClerkWebhookServiceDependencies = dependencies.ingest
    ? { ingest: dependencies.ingest }
    : {};
  const controller = createClerkWebhookController(
    createClerkWebhookService(serviceDependencies),
    dependencies.verify ?? verifyClerkWebhook,
    dependencies.signingSecret,
  );

  router.post(
    '/webhooks/clerk',
    rateLimit({ windowMs: 60_000, max: 60, keyOf: (req) => req.ip || 'unknown' }),
    requireClerkJsonContentType,
    express.raw({ type: 'application/json', limit: '256kb' }),
    controller,
  );

  router.use(handleClerkRawBodyError);

  return router;
}

export const clerkWebhookRouter = createClerkWebhookRouter({
  signingSecret: config.CLERK_WEBHOOK_SIGNING_SECRET,
});
