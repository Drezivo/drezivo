import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { RateLimitedError } from '../shared/errors.js';

interface RateLimitOptions {
  /** Sliding window in milliseconds. */
  windowMs: number;
  /** Max requests per key inside the window. */
  max: number;
  /** How to derive the bucket key — e.g. IP for anonymous checkout, membership id for staff. */
  keyOf: (req: Request) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process sliding-window limiter. TRD §3 requires rate-limiting on auth and on anonymous
 * checkout identity specifically (guest holds, resend endpoints); this is deliberately a
 * single-process approximation — a real multi-instance deployment needs a shared store
 * (Redis) so limits hold across replicas, which TRD §9 explicitly defers until a measured
 * scaling trigger justifies adding Redis at all. Swapping the store later does not change
 * this middleware's interface.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  // Bounded memory: sweep expired buckets periodically instead of letting the map grow with
  // every distinct key ever seen (an anonymous-IP or per-session key space is effectively
  // unbounded over the process lifetime). `.unref()` so this timer never keeps the process
  // alive on its own during shutdown.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, options.windowMs);
  sweep.unref();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = options.keyOf(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (bucket.count >= options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      next(new RateLimitedError('Too many requests. Please try again later.', retryAfterSeconds));
      return;
    }

    bucket.count += 1;
    next();
  };
}
