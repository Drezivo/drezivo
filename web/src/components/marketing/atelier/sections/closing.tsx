import Link from 'next/link';

import type { MarketingFaq } from '@/lib/marketing-content';

export function FaqTeaser({ faqs }: { faqs: readonly MarketingFaq[] }) {
  return (
    <section id="faq" data-header="light" className="bg-atelier-paper-2 py-28 text-atelier-ink lg:py-40">
      <div className="at-container grid gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-gold-ink">Questions</p>
          <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(2.25rem,4.4vw,3.75rem)] font-normal leading-[1.05] tracking-[-0.02em]">
            <span className="block overflow-hidden"><span data-at-line className="block">Asked often,{' '}</span></span>
            <span className="block overflow-hidden"><span data-at-line className="block italic">answered plainly.{' '}</span></span>
          </h2>
          <p data-at-reveal="up" className="mt-6 max-w-[24rem] text-[1rem] leading-[1.75] text-atelier-muted">
            More in the <Link href="/faq" className="text-atelier-ink underline decoration-atelier-gold underline-offset-4">full FAQ</Link>.
          </p>
        </div>
        <div data-at-stagger className="border-t border-atelier-paper-line">
          {faqs.map((faq) => (
            <details key={faq.question} data-at-item className="at-faq group border-b border-atelier-paper-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[1.0625rem] font-medium">
                <span>{faq.question}</span>
                <span aria-hidden="true" className="at-faq-icon" />
              </summary>
              <p className="max-w-[40rem] pb-7 pr-10 text-[1rem] leading-[1.75] text-atelier-muted">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ClosingCall({ signUpUrl, trialDays }: { signUpUrl: string; trialDays: number }) {
  return (
    <section data-header="dark" className="relative overflow-hidden bg-atelier-night py-32 text-atelier-paper lg:py-44">
      <div aria-hidden="true" className="at-closing-glow" />
      <div className="at-container relative text-center">
        <p className="at-eyebrow text-atelier-champagne" data-at-reveal="up">Your shop, organised</p>
        <h2 data-at-reveal="lines" className="mx-auto mt-6 max-w-[56rem] font-[family-name:var(--font-atelier-display)] text-[clamp(2.75rem,6.4vw,5.75rem)] font-normal leading-[1] tracking-[-0.02em]">
          <span className="block overflow-hidden"><span data-at-line className="block">Give your evenings{' '}</span></span>
          <span className="block overflow-hidden"><span data-at-line className="block italic">back to yourself.{' '}</span></span>
        </h2>
        <div data-at-reveal="up" className="mt-12 flex flex-wrap justify-center gap-3">
          <a href={signUpUrl} className="at-button at-button-light">Start your {trialDays}-day free trial</a>
          <Link href="/pricing" className="at-button at-button-ghost-dark">See pricing</Link>
        </div>
      </div>
    </section>
  );
}
