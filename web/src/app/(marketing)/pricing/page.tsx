import type { Metadata } from 'next';
import Link from 'next/link';

import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { buildMarketingMetadata } from '@/lib/seo';
import { getPublicPlans } from '@/lib/plans';
import { SIGN_UP_URL } from '@/lib/site-urls';

export const metadata: Metadata = buildMarketingMetadata(
  'Pricing',
  'Simple, transparent pricing for Philippine clothing rental businesses. No hidden fees.',
);

/**
 * The same plan showcase as the landing page, as a page of its own. Never reintroduce the outdated
 * ₱999/₱1,999/₱3,999 figures, "unlimited items", "advanced reporting", or "dedicated support"
 * from the old reference screenshot: no plan sells those (Drezivo-PRD §6).
 */
const BILLING_TERMS = [
  {
    title: 'Start without a card',
    body: 'The free trial needs no credit card and no payment account.',
  },
  {
    title: 'Pay the way you get paid',
    body: 'Pay monthly by GCash, Maya, or bank transfer and upload your receipt in the app.',
  },
  {
    title: 'Your records stay yours',
    body: 'If a month ends unpaid, your shop turns view-only. Your data is never deleted.',
  },
  {
    title: 'Price changes come with notice',
    body: 'If the price of your plan changes, you keep your current price for three months before the new one applies.',
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <PlanShowcase plans={getPublicPlans()} signUpUrl={SIGN_UP_URL} headingLevel="h1" />
      <section data-header="light" className="at-linen py-20 text-atelier-ink lg:py-28">
        <div className="at-container">
          <h2 className="at-eyebrow text-atelier-gold-ink">How billing works</h2>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-[1.25rem] border border-atelier-paper-line bg-atelier-paper-line sm:grid-cols-2 lg:grid-cols-4">
            {BILLING_TERMS.map((term) => (
              <li key={term.title} className="bg-atelier-paper-2 p-7">
                <h3 className="font-[family-name:var(--font-atelier-display)] text-[1.375rem] font-normal leading-[1.2]">{term.title}</h3>
                <p className="mt-3 text-[0.9375rem] leading-[1.7] text-atelier-muted">{term.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-[0.9375rem] text-atelier-muted">
            More questions?{' '}
            <Link href="/faq" className="text-atelier-ink underline decoration-atelier-gold underline-offset-4">Read the FAQ</Link>
            {' '}or the <Link href="/terms" className="text-atelier-ink underline decoration-atelier-gold underline-offset-4">Terms of Service</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
