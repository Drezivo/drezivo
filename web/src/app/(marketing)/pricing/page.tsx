import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMarketingMetadata } from '@/lib/seo';
import { formatPhpPerUnit } from '@/lib/money';
import { MARKETING_PLANS } from '@/lib/marketing-content';
import { SIGN_UP_URL } from '@/lib/site-urls';

export const metadata: Metadata = buildMarketingMetadata(
  'Pricing',
  'Simple, transparent pricing for Philippine clothing rental businesses. No hidden fees.',
);

/**
 * Prices and quotas are the user-confirmed authoritative figures from
 * Drezivo-PRD.md §1 and §6 (confirmed 15 September 2026). The ₱999/₱1,999/
 * ₱3,999 figures that appear in an older reference screenshot are explicitly
 * documented as outdated and must never be reintroduced here. "Unlimited
 * items," "advanced reporting," and "dedicated support" are also not carried
 * over from that screenshot — PRD §6 is explicit that no plan sells those
 * without a separately approved entitlement and support budget.
 */
export default function PricingPage() {
  return (
    <section className="marketing-container py-20 lg:py-28">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-marketing-gold-strong">Pricing</p>
        <h1 className="mt-5 font-display text-5xl text-marketing-ink">
          Simple, transparent pricing
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-marketing-muted">
          One plan with everything included. Try it free for 14 days, then ₱300 a month.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-md gap-6">
        {MARKETING_PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-lg border p-6 ${
              plan.highlighted ? 'border-marketing-brown bg-marketing-dark text-marketing-cream shadow-xl' : 'border-marketing-line bg-marketing-panel text-marketing-ink'
            }`}
          >
            <p className="font-medium">{plan.name}</p>
            <p className={`mt-1 text-sm ${plan.highlighted ? 'text-marketing-cream/70' : 'text-marketing-muted'}`}>{plan.blurb}</p>
            <p className="mt-4 font-display text-3xl font-semibold">
              {formatPhpPerUnit(plan.price, 'month')}
            </p>
            <ul className={`mt-6 space-y-2 text-sm ${plan.highlighted ? 'text-marketing-cream/80' : 'text-marketing-muted'}`}>
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden="true" className="text-marketing-gold">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            <a
              href={SIGN_UP_URL}
              className={`mt-8 block rounded-md px-4 py-2.5 text-center text-sm font-medium ${
                plan.highlighted
                  ? 'bg-marketing-cream text-marketing-dark'
                  : 'border border-marketing-line text-marketing-ink'
              }`}
            >
              Start your free trial
            </a>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-4 rounded-2xl border border-marketing-line bg-marketing-panel p-6 text-sm text-marketing-muted sm:grid-cols-3">
        <p>No credit card needed for the 14-day trial.</p>
        <p>Pay monthly by GCash, Maya, or bank transfer and upload your receipt.</p>
        <p>If a month ends unpaid, your shop turns view-only; your data is never deleted.</p>
      </div>

      <p className="mt-10 text-center text-sm text-marketing-muted">
        Have questions about pricing?{' '}
        <Link href="/faq" className="text-marketing-brown underline underline-offset-2">
          Read the FAQ
        </Link>
        .
      </p>
    </section>
  );
}
