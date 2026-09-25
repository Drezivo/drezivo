import { Home, SearchX } from "lucide-react";
import Link from "next/link";

import { NotFoundBackButton } from "@/components/shell/not-found-back-button";

export default function NotFound() {
  return (
    <main className="dashboard-theme-dark relative flex min-h-svh items-center justify-center overflow-hidden bg-dashboard-canvas px-6 py-12 text-dashboard-navy">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,color-mix(in_srgb,var(--color-dashboard-accent)_10%,transparent),transparent_34%)]"
      />

      <section className="relative w-full max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-dashboard-border bg-dashboard-surface shadow-sm">
          <SearchX className="h-6 w-6 text-dashboard-accent" aria-hidden="true" />
        </div>

        <div className="mt-6 inline-flex items-center rounded-full border border-dashboard-border bg-dashboard-surface px-3 py-1 text-xs font-semibold tracking-[0.18em] text-dashboard-accent">
          ERROR 404
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
          Page not found
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-dashboard-muted sm:text-base">
          The page you&apos;re looking for doesn&apos;t exist, may have moved, or isn&apos;t
          available in this workspace.
        </p>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="dashboard-button-default inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-canvas"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <NotFoundBackButton />
        </div>

        <p className="mt-8 text-xs text-dashboard-muted">
          If you reached this page from Drezivo, return to the dashboard and try again.
        </p>
      </section>
    </main>
  );
}
