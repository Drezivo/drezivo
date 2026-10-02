import { Bodoni_Moda, Jost } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';

import { NotFoundBackButton } from '@/components/ui/not-found-back-button';

const display = Bodoni_Moda({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'], variable: '--font-nf-display', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-nf-body', display: 'swap' });

/**
 * The one 404 for the landing site and every storefront. It is deliberately generic: it is also
 * what renders for a foreign or unpublished tenant slug (see src/app/s/[slug]/page.tsx), so it must
 * never hint at whether a store exists, only that this page doesn't.
 *
 * Same layout and copy as the workspace and operator console 404s (app/src/app/not-found.tsx,
 * Drezivo-Operator-Web); only the primary action differs.
 */
export default function NotFound() {
  return (
    <main
      className={`${display.variable} ${body.variable} relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-atelier-paper px-6 py-16 text-center text-atelier-ink`}
      style={{ fontFamily: 'var(--font-nf-body), ui-sans-serif, system-ui, sans-serif' }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-[clamp(10rem,34vw,26rem)] italic leading-none text-atelier-gold-ink/[0.07]"
        style={{ fontFamily: 'var(--font-nf-display), Georgia, serif' }}
      >
        404
      </span>

      <div className="relative flex max-w-lg flex-col items-center">
        <Link href="/" aria-label="Drezivo" className="flex items-center gap-2">
          <Image src="/brand/drezivo-mark.png" alt="" width={497} height={600} className="h-9 w-9 object-contain" />
          <span className="text-2xl font-medium" style={{ fontFamily: 'var(--font-nf-display), Georgia, serif' }}>
            Drezivo
          </span>
        </Link>

        <p className="mt-12 text-[0.6875rem] font-medium uppercase tracking-[0.3em] text-atelier-muted">Error 404</p>
        <h1
          className="mt-3 text-[clamp(2.25rem,1.6rem+3vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-nf-display), Georgia, serif' }}
        >
          Page not found
        </h1>
        <span aria-hidden="true" className="mt-6 block h-px w-16 bg-atelier-gold-ink/60" />
        <p className="mt-6 text-base leading-7 text-atelier-muted">The page you are looking for does not exist or has moved.</p>

        <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-atelier-night px-7 text-sm font-medium text-atelier-paper transition-colors hover:bg-atelier-night-3"
          >
            Back to Drezivo
          </Link>
          <NotFoundBackButton />
        </div>
      </div>
    </main>
  );
}
