"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

/**
 * Route-level error boundary. Shows the TRD §4 request_id so a merchant can quote it to
 * support — never a raw stack trace or a swallowed blank screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Structured, redacted logging only (TRD §6/§8) — no request bodies, no secrets.
    // eslint-disable-next-line no-console -- placeholder until the observability sink lands
    console.error("Unhandled dashboard error", { message: error.message, digest: error.digest });
  }, [error]);

  const requestId = error instanceof ApiError ? error.requestId : error.digest;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-100 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink-900">Something went wrong</h1>
      <p className="max-w-md text-sm text-ink-500">
        We couldn&apos;t load this page. Try again, and if it keeps happening, share this reference with
        support.
      </p>
      {requestId && (
        <code className="rounded-md bg-white px-3 py-1 text-xs text-ink-700 shadow-sm">
          Reference: {requestId}
        </code>
      )}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
