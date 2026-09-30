import { describe, expect, it, vi } from 'vitest';

import { createTurnstileVerifier } from '../turnstile.js';

const answer = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) });

describe('turnstile verifier', () => {
  it('passes only a token Cloudflare accepted, sending the secret, token and client IP', async () => {
    const fetchImpl = answer({ success: true });
    expect(await createTurnstileVerifier('secret-1', fetchImpl).verify('token-1', '203.0.113.9')).toBe('passed');
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({ secret: 'secret-1', response: 'token-1', remoteip: '203.0.113.9' });
  });

  it('fails closed on a missing, rejected, or unreadable answer', async () => {
    expect(await createTurnstileVerifier('secret-1', answer({ success: true })).verify(undefined, undefined)).toBe('failed');
    expect(await createTurnstileVerifier('secret-1', answer({ success: false })).verify('token', undefined)).toBe('failed');
    expect(await createTurnstileVerifier('secret-1', answer({ success: 'true' })).verify('token', undefined)).toBe('failed');
    expect(await createTurnstileVerifier('secret-1', answer({ success: true }, false)).verify('token', undefined)).toBe('failed');
  });

  it('fails closed when Cloudflare is unreachable or slow', async () => {
    const down = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    expect(await createTurnstileVerifier('secret-1', down).verify('token', undefined)).toBe('failed');
    const slow = vi.fn((_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
    }));
    expect(await createTurnstileVerifier('secret-1', slow, 20).verify('token', undefined)).toBe('failed');
  });

  it('is skipped only when no secret is configured', async () => {
    const fetchImpl = answer({ success: true });
    expect(await createTurnstileVerifier(undefined, fetchImpl).verify(undefined, undefined)).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
