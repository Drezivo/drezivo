import Image from "next/image";
import Link from "next/link";

import { NotFoundBackButton } from "@/components/shell/not-found-back-button";

/**
 * The Drezivo 404. The same layout and copy ship in the landing site, storefronts, and operator
 * console (web/src/app/not-found.tsx, Drezivo-Operator-Web); only the primary action differs.
 */
export default function NotFound() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-dashboard-canvas px-6 py-16 text-center text-dashboard-navy">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none font-display text-[clamp(10rem,34vw,26rem)] italic leading-none text-dashboard-accent/[0.07]"
      >
        404
      </span>

      <div className="relative flex max-w-lg flex-col items-center">
        <Link href="/" aria-label="Drezivo" className="flex items-center gap-2">
          <Image src="/brand/drezivo-mark.png" alt="" width={497} height={600} className="h-9 w-9 object-contain" />
          <span className="font-display text-2xl font-medium">Drezivo</span>
        </Link>

        <p className="dashboard-eyebrow mt-12">Error 404</p>
        <h1 className="mt-3 font-display text-[clamp(2.25rem,1.6rem+3vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.02em]">
          Page not found
        </h1>
        <span aria-hidden="true" className="mt-6 block h-px w-16 bg-dashboard-accent/60" />
        <p className="mt-6 text-base leading-7 text-dashboard-muted">
          The page you are looking for does not exist or has moved.
        </p>

        <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/"
            className="dashboard-button-default inline-flex min-h-12 items-center justify-center rounded-full px-7 text-sm font-medium transition-colors"
          >
            Back to dashboard
          </Link>
          <NotFoundBackButton />
        </div>
      </div>
    </main>
  );
}
