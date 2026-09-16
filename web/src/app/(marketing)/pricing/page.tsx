import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMarketingMetadata } from '@/lib/seo';
import { formatPhpPerUnit } from '@/lib/money';

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
const PLANS = [
  {
    name: 'Starter',
    price: '300.00',
    blurb: 'Perfect for small businesses just getting started.',
    features: [
      'Up to 50 active physical assets',
      'Owner + Front desk roles',
      'Reservations, calendar & availability',
      'Customer management',
      'Returns, refunds & exports',
    ],
  },
  {
    name: 'Professional',
    price: '499.00',
    blurb: 'For growing businesses with more rentals and customers.',
    features: [
      'Up to 200 active physical assets',
      'Owner + up to 3 Front desk seats',
      'Everything in Starter',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    name: 'Business',
    price: '1299.00',
    blurb: 'For established businesses with higher volume.',
    features: [
      'Up to 1,000 active physical assets',
      'Owner + up to 10 Front desk seats',
      'Everything in Professional',
    ],
  },
] as const;

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">Pricing</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-foreground">
          Simple, transparent pricing
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Choose the plan that fits your business. No hidden fees — just the tools you need to
          grow.
        </p>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-lg border p-6 ${
              plan.highlighted ? 'border-accent bg-surface shadow-sm' : 'border-border bg-surface'
            }`}
          >
            {plan.highlighted ? (
              <p className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                Most Popular
              </p>
            ) : null}
            <p className="font-medium text-foreground">{plan.name}</p>
            <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
            <p className="mt-4 font-display text-3xl font-semibold text-foreground">
              {formatPhpPerUnit(plan.price, 'month')}
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden="true" className="text-accent">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            <a
              href="https://app.drezivo.com/sign-up"
              className={`mt-8 block rounded-md px-4 py-2.5 text-center text-sm font-medium ${
                plan.highlighted
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground'
              }`}
            >
              Get Started
            </a>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-4 rounded-lg border border-border bg-surface p-6 text-sm text-muted sm:grid-cols-3">
        <p>No credit card required to start your 14-day trial.</p>
        <p>Cancel anytime — downgrade or cancel never deletes your data.</p>
        <p>
          Fittings and multi-item booking ship in a later release; every plan above reflects V1
          scope only.
        </p>
      </div>

      <p className="mt-10 text-center text-sm text-muted">
        Have questions about a plan?{' '}
        <Link href="/faq" className="text-accent underline underline-offset-2">
          Read the FAQ
        </Link>
        .
      </p>
    </section>
  );
}
