import express, { type Express } from 'express';
import pinoHttpExport from 'pino-http';

import { clerkContext } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { storefrontRouter } from './modules/storefront/storefront.routes.js';
import { clerkWebhookRouter } from './modules/webhooks/clerk.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { tenancyRouter } from './modules/tenancy/tenancy.routes.js';
import { billingRouter } from './modules/billing/billing.routes.js';
import { membershipInvitationsRouter } from './modules/membership-invitations/membership-invitations.routes.js';
import { logger } from './shared/logger.js';
import { sendError } from './shared/response.js';
import { ValidationError } from './shared/errors.js';

const pinoHttp = pinoHttpExport as unknown as (
  options: Record<string, unknown>,
) => express.RequestHandler;

/**
 * Middleware order matters and is deliberate — earlier entries must be safe to run before
 * later ones have set anything up:
 *   1. request-id      — every later log line and every error response needs this.
 *   2. pino-http        — structured request logging; relies on request-id already being set.
 *   3. onboarding parser — raw owner-command bytes are bounded before provider auth/parsing.
 *   4. clerkContext     — attaches Clerk's verifier; does not itself reject (public routes exist).
 *   5. /webhooks/clerk  — raw bytes must reach Clerk/Svix before the global JSON parser.
 *   6. express.json()   — bounded body size (TRD §4: "Restrict content types, body size").
 *   7. /api/v1 routes   — each route composes its own auth/tenant/idempotency middleware.
 *   8. errorHandler     — must be LAST; Express only treats a 4-arg handler as error middleware
 *                          when it is registered after every route that can throw.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req: express.Request) => ({ method: req.method, requestId: req.requestId }),
        res: () => undefined,
      },
      genReqId: (req: express.Request) => req.requestId ?? '',
      // AGENTS.md: never log secrets/tokens/full request bodies — pino-http's default
      // request/response serializers already omit bodies; headers get the same redaction
      // list as the base logger (see shared/logger.ts).
      autoLogging: {
        ignore: (req: express.Request) => req.url === '/health',
      },
    }),
  );
  const onboardingJson = express.json({ limit: '16kb', type: 'application/json' });
  app.use('/api/v1/onboarding', (req, res, next) => {
    onboardingJson(req, res, (error: unknown) => {
      if (typeof error === 'object' && error !== null && 'type' in error) {
        const errorType = error.type;
        if (errorType === 'entity.too.large') {
          next(new ValidationError('Request body is too large.'));
          return;
        }
        if (errorType === 'entity.parse.failed') {
          next(new ValidationError('Request body is invalid.'));
          return;
        }
      }
      next(error);
    });
  });
  app.use(clerkContext);
  app.use(clerkWebhookRouter);
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Both routers declare their OWN full paths (e.g. `/public/stores/:slug/holds` lives in
  // reservations.routes.ts, not storefront.routes.ts, even though it is nested under
  // `/public/stores`) because creating a hold is a reservations-module write, not a
  // storefront-module read — module ownership drives file placement, not URL shape. Express
  // tries each router in turn and falls through on no match, so two routers can share a URL
  // prefix without a naming collision as long as their concrete route patterns do not overlap.
  const v1 = express.Router();
  v1.use(storefrontRouter);
  v1.use(reservationsRouter);
  v1.use(onboardingRouter);
  v1.use(tenancyRouter);
  v1.use(billingRouter);
  v1.use(membershipInvitationsRouter);
  app.use('/api/v1', v1);

  app.use(errorHandler);

  app.use((req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'Route not found.', req.requestId);
  });

  return app;
}
