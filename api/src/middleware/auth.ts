import { clerkMiddleware, getAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { createClerkServerAdapter } from '../integrations/clerk/clerk.adapter.js';
import { DependencyUnavailableError, ForbiddenError, UnauthenticatedError } from '../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Verified external identity only — NOT tenant membership/authorization (AGENTS.md). */
    clerkPrincipal?: {
      clerkUserId: string;
      clerkOrgId: string | null;
    };
  }
}

/**
 * Attaches Clerk's own request-verification machinery (JWT signature/issuer/expiry/audience).
 * Mounted globally in app.ts, before any route, so `getAuth(req)` is always safe to call
 * downstream — this middleware itself does not reject unauthenticated requests, because public
 * storefront routes must remain reachable without a session.
 */
export const clerkContext: RequestHandler = clerkMiddleware();

/**
 * Route-level gate for staff endpoints: verifies a Clerk session exists and extracts the
 * external identity. This answers "who is the user?" only — resolving that identity to a
 * local tenant membership and capability is `tenant-context.ts`'s job (middleware answers
 * "who"; services answer "is this user allowed to do this" — AGENTS.md). Returns a JSON 401,
 * never an HTML redirect (TRD §3: "For REST, return JSON 401, not a redirect").
 */
export function requireStaffAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth.userId) {
    next(new UnauthenticatedError('Sign-in required.'));
    return;
  }
  req.clerkPrincipal = {
    clerkUserId: auth.userId,
    clerkOrgId: auth.orgId ?? null,
  };
  next();
}

/**
 * Owner onboarding requires proof that the authenticated Clerk user controls a verified
 * primary email. The lookup stays behind the Clerk adapter and runs before any local account,
 * idempotency, or organization mutation. Provider failures fail closed.
 */
export async function requireVerifiedStaffAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  requireStaffAuth(req, _res, async (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    try {
      const verified = await createClerkServerAdapter().getUserVerificationState(
        req.clerkPrincipal!.clerkUserId,
      );
      if (!verified.primaryEmailVerified) {
        next(new ForbiddenError('Email verification is required.'));
        return;
      }
      next();
    } catch (verificationError) {
      next(
        verificationError instanceof DependencyUnavailableError
          ? verificationError
          : new DependencyUnavailableError('Identity verification is temporarily unavailable.'),
      );
    }
  });
}
