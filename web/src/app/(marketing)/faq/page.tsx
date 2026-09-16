import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/seo';
import { MARKETING_FAQS } from '@/lib/marketing-content';

export const metadata: Metadata = buildMarketingMetadata(
  'FAQ',
  'Frequently asked questions about Drezivo, guest bookings, and billing.',
);

export default function FaqPage() {
  return (
    <section className="marketing-container py-20 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-marketing-gold-strong">FAQ</p>
        <h1 className="mt-5 font-display text-5xl text-marketing-ink">Frequently asked questions</h1>
        <p className="mt-5 text-lg leading-8 text-marketing-muted">A clear answer for the questions we hear most from rental teams.</p>
      </div>
      <div className="mx-auto mt-12 max-w-3xl divide-y divide-marketing-line border-y border-marketing-line">
        {MARKETING_FAQS.map((faq) => (
          <details key={faq.question} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-semibold text-marketing-ink">
              <span>{faq.question}</span>
              <span aria-hidden="true" className="font-display text-2xl font-normal text-marketing-gold transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-4 max-w-2xl pr-8 text-sm leading-7 text-marketing-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
