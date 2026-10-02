"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Shows a safe reference when one is available and never exposes
 * a raw stack trace or swallowed blank screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Structured, redacted logging only (TRD §6/§8) — no request bodies, no secrets.
    // eslint-disable-next-line no-console -- placeholder until the observability sink lands
    console.error("Unhandled app error", { message: error.message, digest: error.digest });
  }, [error]);

  const requestId = error.digest;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-dashboard-canvas px-6 text-center text-dashboard-navy">
      <p className="dashboard-eyebrow">Error</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,1.5rem+2.5vw,3rem)] font-medium leading-tight">Something went wrong</h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-dashboard-muted">
        We couldn&apos;t load this page. Try again, and if it keeps happening, share this reference with
        support.
      </p>
      {requestId && (
        <code className="mt-4 rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-1 text-xs text-dashboard-muted">
          Reference: {requestId}
        </code>
      )}
      <Button onClick={reset} className="mt-8 min-h-12 rounded-full px-7">
        Try again
      </Button>
    </main>
  );
}
