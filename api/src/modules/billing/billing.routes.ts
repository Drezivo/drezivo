import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { submitSubscriptionPaymentRequest, type SubmitSubscriptionPaymentRequest } from '@drezivo/contracts';

import { requireStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  requireSubscriptionContext,
  requireSubscriptionIdempotencyKey,
  requireTenantOwner,
  validateChangeSubscriptionPlan,
} from './billing.middleware.js';
import { changeSubscriptionPlanController } from './billing.controller.js';
import { commandHandler, readHandler, workspaceRateLimit } from '../../middleware/staff-command.js';
import { validate } from '../../middleware/validate.js';
import { ForbiddenError } from '../../shared/errors.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { getBillingOverview, readPlatformQr, signPaymentProofUrl, submitSubscriptionPayment, type BillingActor } from './billing-payments.service.js';
import { verifyProofLink } from './operator-proof-link.js';

const methodParams = z.object({ methodId: z.string().uuid() }).strict();

export const billingRouter = Router();

billingRouter.post(
  '/subscription/plan',
  requireStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  requireTenantContext,
  requireSubscriptionContext,
  requireTenantOwner,
  validateChangeSubscriptionPlan,
  requireSubscriptionIdempotencyKey,
  changeSubscriptionPlanController,
);

// Pilot billing: the Subscribe dialog's data, Drezivo's QR images, and payment proof submission.
// These stay reachable while the workspace is view-only or locked (see ./access-gate.ts).
const billingActor = (req: Request): BillingActor => {
  const context = req.tenantContext;
  if (!context) throw new ForbiddenError('Tenant context is required.');
  return {
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    principalId: req.clerkPrincipal?.clerkUserId ?? 'unknown',
    role: context.role,
    requestId: req.requestId ?? 'unknown',
  };
};
const billingRead = [requireStaffAuth, requireTenantContext, workspaceRateLimit(60), requireTenantAction('context_read')];

billingRouter.get('/billing', ...billingRead, readHandler((req) => getBillingOverview(billingActor(req))));

billingRouter.get('/billing/payment-methods/:methodId/qr', ...billingRead, validate({ params: methodParams }), async (req: Request, res: Response) => {
  const qr = await readPlatformQr(billingActor(req), (req.params as { methodId: string }).methodId);
  res.setHeader('Content-Type', qr.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.status(200).send(qr.bytes);
});

billingRouter.post(
  '/billing/payments',
  requireStaffAuth,
  requireTenantContext,
  workspaceRateLimit(10),
  requireTenantAction('context_read'),
  validate({ body: submitSubscriptionPaymentRequest }),
  commandHandler((req, key) => submitSubscriptionPayment(billingActor(req), key, req.body as SubmitSubscriptionPaymentRequest)),
);

// Operator proof link: signed by the operator API after it authorized its operator; this only
// verifies the signature and redirects to a short-lived signed storage URL (see operator-proof-link.ts).
billingRouter.get(
  '/operator/payment-proofs/:token',
  rateLimit({ windowMs: 60_000, max: 60, keyOf: (req) => `proof-link:${req.ip ?? 'unknown'}` }),
  async (req: Request, res: Response) => {
    const token = (req.params as { token?: unknown }).token;
    const grant = typeof token === 'string' ? verifyProofLink(token) : null;
    const signed = grant ? await signPaymentProofUrl(grant.tenantId, grant.paymentId, 'proof-link') : null;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!signed) {
      res.status(404).type('text/plain').send('This proof link is not valid or has expired. Open it again from the operator console.');
      return;
    }
    res.redirect(302, signed.url);
  },
);
