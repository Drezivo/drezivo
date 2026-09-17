import { verifyWebhook } from '@clerk/express/webhooks';
import type { Request } from 'express';

export interface ClerkWebhookVerifierOptions {
  signingSecret: string;
}

export type ClerkWebhookVerifier = (
  request: Request,
  options: ClerkWebhookVerifierOptions,
) => Promise<unknown>;

export function verifyClerkWebhook(
  request: Request,
  options: ClerkWebhookVerifierOptions,
): Promise<unknown> {
  return verifyWebhook(request, options);
}
