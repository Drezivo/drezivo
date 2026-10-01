import type { Metadata } from 'next';
import Link from 'next/link';

import { buildMarketingMetadata } from '@/lib/seo';
import { MARKETING_FAQ_GROUPS, MARKETING_FAQS } from '@/lib/marketing-content';

export const metadata: Metadata = buildMarketingMetadata(
  'FAQ',
  'Answers about the Drezivo trial, billing, guest bookings, payments, and running your rental shop.',
);

const groupId = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** schema.org FAQPage, so search engines can show the answers directly. */
const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: MARKETING_FAQS.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
  // `<` cannot appear raw inside a script element without risking an early close.
}).replace(/</g, '\\u003c');

export default function FaqPage() {
  return (
    <section data-header="light" className="at-linen py-at-section text-atelier-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <div className="at-container grid gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <p className="at-eyebrow text-atelier-gold-ink">FAQ</p>
          <h1 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-hero font-normal">
            Asked often,{' '}
            <span className="italic">answered plainly.</span>
          </h1>
          <p className="mt-6 max-w-[24rem] text-at-body text-atelier-muted">
            What rental shop owners ask before they start: the trial, billing, bookings, and who stays in control.
          </p>
          <nav aria-label="FAQ sections" className="mt-10">
            <ul className="space-y-3 text-at-body">
              {MARKETING_FAQ_GROUPS.map((group) => (
                <li key={group.title}>
                  <Link href={`#${groupId(group.title)}`} className="text-atelier-ink underline decoration-atelier-gold underline-offset-4">
                    {group.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="space-y-16">
          {MARKETING_FAQ_GROUPS.map((group) => (
            <div key={group.title} id={groupId(group.title)} className="scroll-mt-32">
              <h2 className="at-eyebrow text-atelier-gold-ink">{group.title}</h2>
              <div className="mt-5 border-t border-atelier-paper-line">
                {group.faqs.map((faq) => (
                  <details key={faq.question} className="at-faq group border-b border-atelier-paper-line">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-at-lead font-medium">
                      <span>{faq.question}</span>
                      <span aria-hidden="true" className="at-faq-icon" />
                    </summary>
                    <p className="max-w-[40rem] pb-7 pr-10 text-at-body text-atelier-muted">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
