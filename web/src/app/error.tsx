'use client';

import { useEffect } from 'react';

/**
 * Root error boundary. Never renders `error.message` — an unhandled
 * exception can carry a raw database/API error string, and Drezivo-TRD.md §4
 * requires that we "never return raw SQL errors or foreign-key information
 * that identifies another tenant." The message is logged to the console for
 * local debugging only; production error reporting should replace this with
 * a redacted-by-default monitoring call, never the raw message shipped to
 * the browser.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error boundary triggered', { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-2xl text-foreground">Something went wrong.</p>
      <p className="max-w-md text-sm text-muted">
        We hit a snag loading this page. Nothing was charged and no reservation was changed.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}
