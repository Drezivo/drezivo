'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Cloudflare Turnstile "I'm not a robot" check. The API verifies each token with Cloudflare before
 * sending a verification email, so bots cannot use the storefront to spam inboxes. Tokens are
 * single-use: call `reset()` after every attempt. Without NEXT_PUBLIC_TURNSTILE_SITE_KEY (local
 * development) nothing renders, and the API skips the check when it has no secret either.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export const TURNSTILE_SITE_KEY = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

export const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void; onUnavailable?: () => void }>(function Turnstile(
  { onToken, onUnavailable },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onUnavailable });
  callbacks.current = { onToken, onUnavailable };

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      callbacks.current.onToken(null);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          size: 'flexible',
          callback: (token: string) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => callbacks.current.onToken(null),
        });
      })
      .catch(() => callbacks.current.onUnavailable?.());
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={container} className="min-h-[65px]" />;
});
