import Image from 'next/image';
import type { Metadata } from 'next';
import { MarketingHero } from '@/components/marketing/marketing-hero';
import { formatPhpPerUnit } from '@/lib/money';
import { MARKETING_FAQS, MARKETING_FEATURES, MARKETING_PLANS } from '@/lib/marketing-content';
import { buildMarketingMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMarketingMetadata(
  'Clothing Rental Management Software',
  'Drezivo helps Philippine clothing rental businesses manage inventory, reservations, customers, and operations in one place.',
);

const SIGN_UP_URL = 'https://app.drezivo.com/sign-up';

const DIFFERENTIATORS = MARKETING_FEATURES.slice(0, 4);

const SOLUTION_FEATURES = [
  {
    icon: 'grid',
    title: 'Centralized Management',
    body: 'Handle your clothing, reservations, customers, and operations — all in one dashboard.',
  },
  {
    icon: 'calendar',
    title: 'Real-Time Availability',
    body: 'Know what’s available, what’s reserved, and what’s currently rented.',
  },
  {
    icon: 'bell',
    title: 'Automated & Organized',
    body: 'Reduce manual work with smart tracking, reminders, and notifications.',
  },
  {
    icon: 'hanger',
    title: 'Designed for Rental Businesses',
    body: 'Built specifically for clothing rental, with the tools you actually need.',
  },
] as const;

const SOLUTION_STATS = [
  ['Today’s Reservations', '8', '+12% yesterday'],
  ['Active Rentals', '12', '+3% yesterday'],
  ['Pending Payments', '3', 'Needs attention'],
] as const;

const SOLUTION_RESERVATIONS = [
  ['Black Satin Gown', 'Sep 12 · 10:00 AM', 'Reserved'],
  ['Red Evening Dress', 'Sep 12 · 2:00 PM', 'Rented'],
  ['White Wedding Gown', 'Sep 13 · 9:00 AM', 'Pickup'],
] as const;

export default function LandingPage() {
  return (
    <>
      <MarketingHero />

      <section id="features" className="bg-marketing-ivory py-20 lg:py-24">
        <div className="marketing-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="marketing-eyebrow"><span aria-hidden="true" />The problem</p>
            <h2 className="mt-5 max-w-xl font-display text-4xl leading-[1.1] text-marketing-ink sm:text-5xl">Running a clothing rental business shouldn’t be this hard.</h2>
            <p className="mt-5 max-w-lg leading-7 text-marketing-muted">Many rental businesses are still stuck with manual processes, fragmented tools, and constant back-and-forth with customers. It’s time for a better way.</p>
          </div>
          <div className="problem-visual relative overflow-visible">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[1.5rem]">
              <Image src="/marketing/problem-reference.png" alt="A clothing rental owner feeling overwhelmed while working beside a laptop and garment rack" fill sizes="(min-width: 1024px) 55vw, 100vw" className="problem-image object-cover" />
            </div>
            <ul aria-label="Common manual rental tools" className="pointer-events-none absolute inset-0">
              <li className="problem-pill problem-pill-left problem-pill-top"><span aria-hidden="true">▣</span>Spreadsheets</li>
              <li className="problem-pill problem-pill-left problem-pill-middle"><span aria-hidden="true">⌁</span>Messengers</li>
              <li className="problem-pill problem-pill-left problem-pill-bottom"><span aria-hidden="true">▤</span>Manual Calendars</li>
              <li className="problem-pill problem-pill-right problem-pill-top"><span aria-hidden="true">◎</span>Instagram</li>
              <li className="problem-pill problem-pill-right problem-pill-middle"><span aria-hidden="true">▧</span>Google Forms</li>
              <li className="problem-pill problem-pill-right problem-pill-bottom"><span aria-hidden="true">▥</span>Payment Screenshots</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="how-it-works" data-testid="solution-section" className="solution-section py-20 lg:py-24">
        <Image
          src="/marketing/solution-backdrop.png"
          alt=""
          fill
          sizes="100vw"
          className="solution-backdrop"
          data-testid="solution-backdrop"
        />

        <div className="marketing-container relative z-10">
          <div className="mx-auto max-w-2xl text-center">
            <p className="marketing-eyebrow solution-eyebrow"><span aria-hidden="true" />The solution<span aria-hidden="true" /></p>
            <h2 className="mt-5 font-display text-4xl leading-[1.05] text-marketing-ink sm:text-5xl">Everything you need, in one place.</h2>
            <p className="mt-5 leading-7 text-marketing-muted">Drezivo gives you a complete, easy-to-use system to manage your clothing rental business - from inventory and reservations to customers, payments, and more.</p>
          </div>

          <div className="solution-showcase">
            <ul className="solution-feature-list" aria-label="Drezivo solution highlights">
              {SOLUTION_FEATURES.map((feature) => (
                <li key={feature.title} className="solution-feature">
                  <span aria-hidden="true" className={`solution-feature-icon solution-feature-icon-${feature.icon}`} />
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="solution-visual" data-testid="solution-visual">
              <div data-testid="solution-dashboard" className="solution-dashboard">
                <div className="solution-dashboard-topbar">
                  <span className="solution-dashboard-brand">Drezivo</span>
                  <span className="solution-dashboard-search">Search anything...</span>
                  <span className="solution-dashboard-avatar" aria-hidden="true" />
                </div>
                <div className="solution-dashboard-body">
                  <nav aria-label="Dashboard preview navigation" className="solution-dashboard-nav">
                    {['Dashboard', 'Reservations', 'Calendar', 'Clothing', 'Customers', 'Payments', 'Storefront', 'Settings'].map((item) => (
                      <span key={item} className={item === 'Dashboard' ? 'is-active' : undefined}>{item}</span>
                    ))}
                  </nav>
                  <div className="solution-dashboard-main">
                    <p className="solution-dashboard-greeting">Good morning, Luna!</p>
                    <p className="solution-dashboard-subcopy">Here&apos;s what&apos;s happening with your rental business today.</p>
                    <div className="solution-stat-grid">
                      {SOLUTION_STATS.map(([label, value, note]) => (
                        <div key={label} className="solution-stat-card">
                          <span>{label}</span>
                          <strong>{value}</strong>
                          <small>{note}</small>
                        </div>
                      ))}
                    </div>
                    <div className="solution-reservations">
                      <p>Upcoming Reservations</p>
                      {SOLUTION_RESERVATIONS.map(([name, time, status]) => (
                        <div key={name} className="solution-reservation-row">
                          <span aria-hidden="true" className="solution-dress-thumb" />
                          <span><strong>{name}</strong><small>{time}</small></span>
                          <em>{status}</em>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div data-testid="solution-phone" className="solution-phone" aria-label="Mobile storefront preview">
                <div className="solution-phone-notch" aria-hidden="true" />
                <div className="solution-phone-image" aria-hidden="true" />
                <p>Black Satin Gown</p>
                <strong>PHP 1,500/day</strong>
                <span>Select Dates</span>
                <div className="solution-phone-thumbs" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-marketing-ivory py-20 lg:py-24">
        <div className="marketing-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div><p className="marketing-eyebrow"><span aria-hidden="true" />The differentiator</p><h2 className="mt-5 max-w-xl font-display text-4xl leading-[1.1] text-marketing-ink sm:text-5xl">Built for clothing rental businesses, by people who get it.</h2><p className="mt-5 max-w-lg leading-7 text-marketing-muted">We’re not just another business tool. Drezivo is created specifically for clothing rental businesses, with features that make your daily operations simpler, faster, and more organized.</p><div className="relative mt-8 h-52 overflow-hidden rounded-t-[7rem] rounded-b-xl sm:h-64"><Image src="/marketing/differentiator-showroom.png" alt="A refined clothing rack in a bright boutique showroom" fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" /></div></div>
          <div className="grid gap-4 sm:grid-cols-2">{DIFFERENTIATORS.map((feature, index) => <article key={feature.label} className="rounded-xl border border-marketing-line bg-marketing-panel p-6"><span aria-hidden="true" className="text-xl text-marketing-gold">{['♧', '♧', '✿', '♡'][index]}</span><h3 className="mt-5 font-display text-xl text-marketing-ink">{feature.title}</h3><p className="mt-2 text-sm leading-6 text-marketing-muted">{feature.body}</p></article>)}</div>
        </div>
      </section>

      <section id="pricing" className="py-20 lg:py-24">
        <div className="marketing-container"><div className="max-w-xl"><p className="marketing-eyebrow"><span aria-hidden="true" />Pricing</p><h2 className="mt-5 font-display text-4xl text-marketing-ink sm:text-5xl">Simple, transparent pricing.</h2><p className="mt-4 leading-7 text-marketing-muted">Choose the plan that fits your business needs. No hidden fees—just the tools you need to grow.</p></div><div className="mt-10 grid gap-5 lg:grid-cols-3">{MARKETING_PLANS.map((plan) => <article key={plan.name} className={`relative rounded-xl border p-6 ${plan.highlighted ? 'border-marketing-brown bg-marketing-panel shadow-lg' : 'border-marketing-line bg-marketing-panel'}`}>{plan.highlighted ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-marketing-brown px-3 py-1 text-[10px] font-semibold text-marketing-cream">Most Popular</span> : null}<h3 className="text-lg font-medium text-marketing-ink">{plan.name}</h3><p className="mt-1 text-sm text-marketing-muted">{plan.blurb}</p><p className="mt-5 font-display text-3xl text-marketing-ink">{formatPhpPerUnit(plan.price, 'month')}</p><ul className="mt-5 space-y-2 text-sm text-marketing-muted">{plan.features.map((feature) => <li key={feature} className="flex gap-2"><span aria-hidden="true" className="text-marketing-gold">✓</span>{feature}</li>)}</ul><a href={SIGN_UP_URL} className={`mt-7 block rounded-full border px-4 py-2.5 text-center text-sm font-medium ${plan.highlighted ? 'border-marketing-brown bg-marketing-brown text-marketing-cream' : 'border-marketing-line text-marketing-brown'}`}>Get Started</a></article>)}</div></div>
      </section>

      <section id="faq" className="bg-marketing-ivory py-20 lg:py-24">
        <div className="marketing-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center"><div><p className="marketing-eyebrow"><span aria-hidden="true" />FAQ</p><h2 className="mt-5 font-display text-4xl text-marketing-ink sm:text-5xl">Frequently asked questions.</h2><p className="mt-4 max-w-md leading-7 text-marketing-muted">Find quick answers to common questions about Drezivo, guest bookings, and billing.</p><div className="mt-8 grid gap-3 sm:grid-cols-[0.8fr_1.2fr] sm:items-end"><div className="relative h-44 overflow-hidden rounded-xl"><Image src="/marketing/faq-showroom.png" alt="Dresses arranged in a warm showroom" fill sizes="(min-width: 640px) 24vw, 90vw" className="object-cover" /></div><div className="rounded-xl border border-marketing-line bg-marketing-panel p-5"><p className="text-sm font-semibold text-marketing-ink">Still have questions?</p><p className="mt-2 text-xs leading-5 text-marketing-muted">Our team is happy to help. Reach out anytime.</p><a href="mailto:hello@drezivo.com" className="marketing-button-primary mt-4 px-4 py-2 text-xs">Contact us</a></div></div></div><div className="divide-y divide-marketing-line rounded-xl border border-marketing-line bg-marketing-panel px-5">{MARKETING_FAQS.map((faq) => <details key={faq.question} className="group py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-marketing-ink"><span>{faq.question}</span><span aria-hidden="true" className="text-marketing-gold transition-transform group-open:rotate-45">＋</span></summary><p className="mt-3 pr-8 text-xs leading-6 text-marketing-muted">{faq.answer}</p></details>)}</div></div>
      </section>

      <section className="bg-marketing-brown py-14 text-marketing-cream"><div className="marketing-container flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center"><div><p className="font-display text-3xl">Simplify your operations. Grow your business.</p><p className="mt-2 text-sm text-marketing-cream/70">Drezivo brings everything together—from reservations to payments.</p></div><a href={SIGN_UP_URL} className="marketing-button-primary bg-marketing-cream px-6 py-3 text-sm !text-marketing-dark">Get Started Free</a></div></section>
    </>
  );
}
