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

const DASHBOARD_DAYS = [
  { id: 'mon', label: 'M', tone: 'bg-marketing-gold/65' },
  { id: 'tue', label: 'T', tone: 'bg-marketing-sage' },
  { id: 'wed', label: 'W', tone: 'bg-marketing-blush' },
  { id: 'thu', label: 'T', tone: 'bg-marketing-sage' },
  { id: 'fri', label: 'F', tone: 'bg-marketing-gold/65' },
  { id: 'sat', label: 'S', tone: 'bg-marketing-blush' },
  { id: 'sun', label: 'S', tone: 'bg-marketing-sage' },
] as const;

const DIFFERENTIATORS = MARKETING_FEATURES.slice(0, 4);

const SOLUTION_FEATURES = [
  ['Centralized Management', 'Inventory, reservations, customers, and operations—all in one dashboard.'],
  ['Real-Time Availability', 'Know what’s available, what’s reserved, and what’s currently rented.'],
  ['Automated & Organized', 'Reduce manual work with smart tracking, reminders, and notifications.'],
  ['Designed for Rental Businesses', 'Built specifically for clothing rental, with the tools you actually need.'],
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

      <section id="how-it-works" className="py-20 lg:py-24">
        <div className="marketing-container grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <p className="marketing-eyebrow"><span aria-hidden="true" />The solution</p>
            <h2 className="mt-5 max-w-md font-display text-4xl leading-[1.1] text-marketing-ink sm:text-5xl">Everything you need, in one place.</h2>
            <p className="mt-5 max-w-md leading-7 text-marketing-muted">Drezivo gives you a complete, easy-to-use system to manage your clothing rental business—from inventory and reservations to customers, payments, and more.</p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {SOLUTION_FEATURES.map(([title, body], index) => (
                <div key={title} className="flex gap-3">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-marketing-cream text-sm text-marketing-gold">{['▦', '▣', '♧', '♙'][index]}</span>
                  <div><h3 className="text-sm font-semibold text-marketing-ink">{title}</h3><p className="mt-1 text-xs leading-5 text-marketing-muted">{body}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative rounded-[2rem] bg-marketing-ivory p-6 sm:p-10">
            <div className="rounded-xl border border-marketing-line bg-marketing-panel p-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-marketing-line pb-3"><span className="text-xs font-semibold text-marketing-brown">Drezivo</span><span className="text-xs text-marketing-muted">Rental Calendar</span><span className="h-2 w-2 rounded-full bg-marketing-gold" /></div>
              <div className="mt-5 grid grid-cols-[5rem_1fr_6rem] gap-3">
                <div className="space-y-2 text-[9px] text-marketing-muted"><span className="block rounded bg-marketing-cream p-1.5 font-semibold text-marketing-brown">Overview</span><span className="block p-1.5">Reservations</span><span className="block p-1.5">Inventory</span><span className="block p-1.5">Customers</span><span className="block p-1.5">Settings</span></div>
                <div><div className="flex items-center justify-between text-[9px] text-marketing-muted"><span>Rental Calendar</span><span>June 2025</span></div><div className="mt-3 grid grid-cols-7 gap-1">{DASHBOARD_DAYS.map((day) => <div key={`solution-${day.id}`} className="text-center text-[8px] text-marketing-muted"><span>{day.label}</span><span className={`mt-1 block h-24 rounded-md ${day.tone}`} /></div>)}</div></div>
                <div className="space-y-2"><span className="block text-[9px] text-marketing-muted">Upcoming Reservations</span><span className="block rounded-md bg-marketing-cream p-2 text-[8px] text-marketing-muted">Today · 09:00<br /><strong className="text-marketing-ink">Maria Santos</strong></span><span className="block rounded-md bg-marketing-cream p-2 text-[8px] text-marketing-muted">Today · 11:30<br /><strong className="text-marketing-ink">Ana Reyes</strong></span></div>
              </div>
            </div>
            <div className="absolute -bottom-3 right-4 rounded-xl border border-marketing-line bg-marketing-panel p-3 shadow-xl sm:bottom-5 sm:right-2"><p className="text-[9px] text-marketing-muted">New reservation</p><p className="mt-1 text-xs font-semibold text-marketing-ink">Maria Santos</p><p className="mt-1 text-[9px] text-marketing-gold-strong">Payment verified</p></div>
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
