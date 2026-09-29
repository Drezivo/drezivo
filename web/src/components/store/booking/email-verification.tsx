'use client';

import { useEffect, useRef, useState } from 'react';

import { confirmVerification, startVerification, StorefrontApiError } from '@/lib/storefront-api';

export interface VerifiedEmail {
  email: string;
  token: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 30;

/** Two-step email check. The token it returns is short-lived and only kept in memory. */
export function EmailVerification({ slug, verified, onVerified }: { slug: string; verified: VerifiedEmail | null; onVerified: (value: VerifiedEmail | null) => void }) {
  const [email, setEmail] = useState(verified?.email ?? '');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>(verified ? 'code' : 'email');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function guarded(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof StorefrontApiError ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const send = () =>
    guarded(async () => {
      const normalized = email.trim().toLowerCase();
      if (!EMAIL.test(normalized)) throw new StorefrontApiError('Enter a valid email address.', 422, 'VALIDATION_FAILED');
      await startVerification(slug, normalized);
      setEmail(normalized);
      setStage('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
      window.setTimeout(() => codeInput.current?.focus(), 0);
    });

  const confirm = () =>
    guarded(async () => {
      if (!/^\d{6}$/.test(code)) throw new StorefrontApiError('Enter the 6-digit code from your email.', 422, 'VALIDATION_FAILED');
      const result = await confirmVerification(slug, email, code);
      onVerified({ email, token: result.verification_token });
    });

  if (verified) {
    return (
      <div className="flex items-center justify-between gap-3 border border-sf-line bg-sf-surface px-4 py-3 text-sm">
        <span>
          <span className="block text-xs text-sf-muted">Verified email</span>
          {verified.email}
        </span>
        <button
          type="button"
          className="text-xs underline underline-offset-4"
          onClick={() => {
            onVerified(null);
            setStage('email');
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stage === 'email' ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="guest-email" className="sr-only">
            Email address
          </label>
          <input id="guest-email" type="email" autoComplete="email" inputMode="email" required className="sf-input" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          <button type="submit" className="sf-button sf-button-primary shrink-0" disabled={pending}>
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <p className="text-sm text-sf-muted">
            We sent a 6-digit code to <span className="text-sf-ink">{email}</span>. It expires in 10 minutes.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="guest-code" className="sr-only">
              Verification code
            </label>
            <input
              id="guest-code"
              ref={codeInput}
              className="sf-input tracking-[0.4em] tabular-nums"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="submit" className="sf-button sf-button-primary shrink-0" disabled={pending || code.length !== 6}>
              {pending ? 'Checking…' : 'Verify'}
            </button>
          </div>
          <div className="flex gap-4 text-xs">
            <button type="button" className="underline underline-offset-4 disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || pending} onClick={() => void send()}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="underline underline-offset-4" onClick={() => setStage('email')}>
              Use another email
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-[#b3311f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
