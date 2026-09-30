import { config } from '../../config/index.js';
import { logger } from '../../shared/logger.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

export type TurnstileOutcome = 'passed' | 'failed' | 'skipped';

export interface TurnstileVerifier {
  /** `passed` only for a token Cloudflare accepted; `skipped` only when no secret is configured. */
  verify(token: string | undefined, remoteIp: string | undefined): Promise<TurnstileOutcome>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

/**
 * Cloudflare Turnstile check for anonymous endpoints that send email. Fails closed: a missing
 * token, a rejected token, a timeout, a network error, or an unreadable answer are all `failed`.
 * Without TURNSTILE_SECRET_KEY (local development) the check is skipped; server.ts logs that once
 * at startup. The secret and the token are never logged.
 */
export function createTurnstileVerifier(
  secret: string | undefined = config.TURNSTILE_SECRET_KEY,
  fetchImpl: FetchLike = fetch,
  timeoutMs = TIMEOUT_MS,
): TurnstileVerifier {
  return {
    async verify(token, remoteIp) {
      if (!secret) return 'skipped';
      if (!token) return 'failed';

      const form = new URLSearchParams({ secret, response: token });
      if (remoteIp) form.set('remoteip', remoteIp);
      try {
        const response = await fetchImpl(SITEVERIFY_URL, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return 'failed';
        const body = (await response.json()) as { success?: unknown };
        return body.success === true ? 'passed' : 'failed';
      } catch (error) {
        logger.warn({ reason: error instanceof Error ? error.name : 'unknown' }, 'turnstile verification unavailable');
        return 'failed';
      }
    },
  };
}

export const turnstileVerifier = createTurnstileVerifier();
