import Link from 'next/link';

import { PatternDraft } from '@/components/marketing/atelier/art/pattern-draft';

const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
] as const;

/**
 * Legal documents in the marketing atelier style. Colours are explicit atelier tokens, never the
 * app theme tokens: marketing pages stay on paper even when the visitor's OS is in dark mode.
 */
export function LegalLayout({
  title,
  updated,
  notice,
  children,
}: {
  title: string;
  updated: string;
  /** Shown above the document while it is still a draft for legal review. */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <section data-header="dark" className="relative isolate overflow-hidden bg-atelier-night pb-16 pt-36 text-atelier-paper lg:pb-24 lg:pt-44">
        <PatternDraft id="legal-draft" className="at-art inset-0 h-full w-full text-atelier-champagne opacity-[0.16]" />
        <div className="at-container">
          <p className="at-eyebrow text-atelier-champagne">Legal</p>
          <h1 className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(2.75rem,6vw,5rem)] font-normal leading-[1.02] tracking-[-0.02em]">
            {title}
          </h1>
          <p className="mt-5 text-sm text-atelier-mist">Last updated: {updated}</p>
          <nav aria-label="Legal documents" className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[0.9375rem]">
            {LEGAL_PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                aria-current={page.label === title ? 'page' : undefined}
                className="text-atelier-mist underline decoration-atelier-night-line underline-offset-8 transition-colors hover:text-atelier-paper aria-[current=page]:text-atelier-paper aria-[current=page]:decoration-atelier-champagne"
              >
                {page.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <section data-header="light" className="bg-atelier-paper py-20 lg:py-28">
        <div className="at-container">
          <article className="at-legal mx-auto max-w-[46rem]">
            {notice ? <p className="at-legal-notice">{notice}</p> : null}
            {children}
          </article>
        </div>
      </section>
    </>
  );
}
