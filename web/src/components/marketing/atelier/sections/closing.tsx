import Link from 'next/link';

import type { MarketingFaq } from '@/lib/marketing-content';

export function FaqTeaser({ faqs }: { faqs: readonly MarketingFaq[] }) {
  return (
    <section id="faq" data-header="light" className="bg-atelier-paper-2 py-at-section text-atelier-ink">
      <div className="at-container grid gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-gold-ink">Questions</p>
          <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display font-normal">
            <span className="block overflow-hidden"><span data-at-line className="block">Asked often,{' '}</span></span>
            <span className="block overflow-hidden"><span data-at-line className="block italic">answered plainly.{' '}</span></span>
          </h2>
          <p data-at-reveal="up" className="mt-6 max-w-[24rem] text-at-body text-atelier-muted">
            More in the <Link href="/faq" className="text-atelier-ink underline decoration-atelier-gold underline-offset-4">full FAQ</Link>.
          </p>
        </div>
        <div data-at-stagger className="border-t border-atelier-paper-line">
          {faqs.map((faq) => (
            <details key={faq.question} data-at-item className="at-faq group border-b border-atelier-paper-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-at-lead font-medium">
                <span>{faq.question}</span>
                <span aria-hidden="true" className="at-faq-icon" />
              </summary>
              <p className="max-w-[40rem] pb-7 pr-10 text-at-body text-atelier-muted">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ClosingCall({ signUpUrl, trialDays }: { signUpUrl: string; trialDays: number }) {
  return (
    <section data-header="dark" className="relative overflow-hidden bg-atelier-night py-at-section text-atelier-paper">
      <div aria-hidden="true" className="at-closing-glow" />
      <div className="at-container relative text-center">
        <p className="at-eyebrow text-atelier-champagne" data-at-reveal="up">Your shop, organised</p>
        <h2 data-at-reveal="lines" className="mx-auto mt-6 max-w-[56rem] font-[family-name:var(--font-atelier-display)] text-at-hero font-normal">
          <span className="block overflow-hidden"><span data-at-line className="block">Give your evenings{' '}</span></span>
          <span className="block overflow-hidden"><span data-at-line className="block italic">back to yourself.{' '}</span></span>
        </h2>
        <div data-at-reveal="up" className="at-cta-row mx-auto mt-10 max-w-[24rem] sm:mt-12 sm:max-w-none sm:justify-center">
          <a href={signUpUrl} className="at-button at-button-light">Start your {trialDays}-day free trial</a>
          <Link href="/pricing" className="at-button at-button-ghost-dark">See pricing</Link>
        </div>
      </div>
    </section>
  );
}
