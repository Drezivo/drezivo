'use client';

import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef, type ReactNode } from 'react';

import { motionAllowed } from '../motion/motion-tokens';

/**
 * One system, every corner of the shop. Each card is a coded mockup in the business app's theme
 * with illustrative sample data; it shows a skeleton first and fills in as it enters the viewport,
 * the way the real app loads.
 */
function Card({ title, body, wide, children }: { title: string; body: string; wide?: boolean; children: ReactNode }) {
  return (
    <article data-at-reveal="blur" data-bento-card className={`at-bento-card ${wide ? 'sm:col-span-2' : ''}`}>
      <div className="at-app at-app-flat">
        <div data-bento-skeleton aria-hidden="true" className="absolute inset-4 grid content-start gap-3">
          <span className="at-skeleton h-4 w-1/2" />
          <span className="at-skeleton h-20 w-full" />
          <span className="at-skeleton h-4 w-2/3" />
        </div>
        <div data-bento-data className="p-[1.1em]">{children}</div>
      </div>
      <h3 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-title font-normal">{title}</h3>
      <p className="mt-2 max-w-[28rem] text-at-body text-atelier-muted">{body}</p>
    </article>
  );
}

function Chip({ tone, children }: { tone: 'gold' | 'green'; children: ReactNode }) {
  return <span className={`at-chip at-chip-${tone}`}>{children}</span>;
}

const TODAY = [
  ['Pickups', '4'],
  ['Returns', '3'],
  ['Fittings', '2'],
  ['To review', '1'],
] as const;

const PIECES = [
  ['Ivory Ball Gown', 'S · M · L', 'Ready', 'green'],
  ['Maria Clara Filipiniana', 'M', 'Out until Dec 16', 'gold'],
  ['Piña Barong', 'L · XL', 'Cleaning', 'muted'],
] as const;

export function ProductBento() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const cards = Array.from(host.querySelectorAll<HTMLElement>('[data-bento-card]'));
    if (!motionAllowed()) {
      cards.forEach((card) => card.setAttribute('data-loaded', ''));
      return;
    }
    const timers: number[] = [];
    const triggers = cards.map((card, index) =>
      ScrollTrigger.create({
        trigger: card,
        start: 'top 82%',
        once: true,
        // The skeleton holds briefly, as a real request would, then the data arrives.
        onEnter: () => timers.push(window.setTimeout(() => card.setAttribute('data-loaded', ''), 650 + index * 90)),
      }),
    );
    return () => {
      triggers.forEach((trigger) => trigger.kill());
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <section ref={root} id="features" data-header="light" className="at-linen py-at-section text-atelier-ink">
      <div className="at-container">
        <div className="max-w-[56rem]" data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-gold-ink">One system</p>
          <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display font-normal">
            <span className="block overflow-hidden"><span data-at-line className="block">Every corner of the shop,{' '}</span></span>
            <span className="block overflow-hidden"><span data-at-line className="block">on one screen.{' '}</span></span>
          </h2>
        </div>

        <div className="mt-at-stack grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-8 lg:gap-y-16">
          <Card wide title="Today, at a glance" body="Pickups, returns, fittings, and payments waiting for you, the moment you open the shop.">
            <p className="at-m-md font-medium text-[var(--app-ink)]">Good morning, Joy</p>
            <p className="mt-1 at-m-xs text-[var(--app-muted)]">Thursday, December 15</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TODAY.map(([label, value]) => (
                <div key={label} className="rounded-md bg-[var(--app-surface-2)] p-3">
                  <p className="at-m-xs text-[var(--app-muted)]">{label}</p>
                  <p className="mt-1 font-[family-name:var(--font-atelier-display)] text-3xl text-[var(--app-ink)]">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 h-14 rounded-md bg-[var(--app-surface-2)] p-2" aria-hidden="true">
              <svg viewBox="0 0 300 40" className="h-full w-full" preserveAspectRatio="none">
                <path d="M0 32 C30 28 45 18 70 22 S120 8 150 14 S210 30 240 16 S285 6 300 10" fill="none" stroke="var(--app-accent)" strokeWidth="1.5" />
              </svg>
            </div>
          </Card>

          <Card title="Every piece, every size" body="Each physical piece has a status, so you know what is ready, out, or being cleaned.">
            <ul className="grid gap-2 at-m-sm">
              {PIECES.map(([name, sizes, status, tone]) => (
                <li key={name} className="flex items-center justify-between gap-2 rounded-md bg-[var(--app-surface-2)] px-2.5 py-2">
                  <span>
                    <span className="block text-[var(--app-ink)]">{name}</span>
                    <span className="at-m-xs text-[var(--app-muted)]">{sizes}</span>
                  </span>
                  <span className={`at-chip at-chip-${tone}`}>{status}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Fittings, without the back-and-forth" body="Renters book a fitting slot from your storefront. Your business hours decide what they can pick.">
            <div className="flex items-baseline justify-between">
              <p className="at-m-md font-medium text-[var(--app-ink)]">Fitting slots</p>
              <p className="at-m-xs text-[var(--app-muted)]">Sat, Dec 17</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center at-m-xs">
              {['10:00', '10:30', '11:00', '1:00', '1:30', '2:00'].map((slot, index) => (
                <span key={slot} className={`rounded-md py-2 ${index === 1 ? 'bg-[var(--app-active)] text-[var(--app-accent)]' : index === 4 ? 'bg-[var(--app-surface-3)] text-[var(--app-muted)] line-through' : 'bg-[var(--app-surface-2)] text-[var(--app-ink)]'}`}>
                  {slot}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-[var(--app-surface-2)] px-2.5 py-2 at-m-xs">
              <span className="text-[var(--app-ink)]">10:30 · Carla Mendoza · Red Mermaid · M</span>
              <Chip tone="gold">Booked</Chip>
            </div>
            <p className="mt-2 at-m-xs text-[var(--app-muted)]">1:30 is outside your Saturday hours.</p>
          </Card>

          <Card title="A history for every renter" body="Contact details, past rentals, deposits, and notes in one record, with their consent kept beside it.">
            <p className="at-m-md text-[var(--app-ink)]">Carla Mendoza</p>
            <p className="at-m-xs text-[var(--app-muted)]">4 rentals · last on Nov 30 · 0917 ••• 4821</p>
            <ul className="mt-3 grid gap-1.5 at-m-xs text-[var(--app-muted)]">
              <li className="flex justify-between"><span>Debut gown · Nov 30</span><span className="text-[var(--app-green)]">Returned</span></li>
              <li className="flex justify-between"><span>Filipiniana · Aug 12</span><span className="text-[var(--app-green)]">Returned</span></li>
              <li className="flex justify-between"><span>Barong · Jun 3</span><span className="text-[var(--app-green)]">Returned</span></li>
            </ul>
            <div className="mt-3 grid gap-1 rounded-md bg-[var(--app-surface-2)] p-2.5 at-m-xs">
              <p className="flex justify-between"><span className="text-[var(--app-muted)]">Deposits</span><span className="text-[var(--app-ink)]">All refunded</span></p>
              <p className="flex justify-between"><span className="text-[var(--app-muted)]">Note</span><span className="text-[var(--app-ink)]">Prefers Saturday fittings</span></p>
              <p className="flex justify-between"><span className="text-[var(--app-muted)]">Consent</span><span className="text-[var(--app-green)]">Recorded Aug 12</span></p>
            </div>
          </Card>

          <Card title="Every peso, accounted for" body="Rental fees, deposits, and refunds sit on each booking, so the day's takings add up without a notebook.">
            <ul className="grid gap-2 at-m-sm">
              {[
                ['GCash · RES-1042', '₱2,500.00', 'green', 'Approved'],
                ['Cash · RES-1039', '₱1,200.00', 'green', 'Recorded'],
                ['Maya · RES-1045', '₱1,800.00', 'gold', 'To review'],
              ].map(([label, amount, tone, status]) => (
                <li key={label} className="flex items-center justify-between gap-2 rounded-md bg-[var(--app-surface-2)] px-2.5 py-2">
                  <span>
                    <span className="block tabular-nums text-[var(--app-ink)]">{amount}</span>
                    <span className="at-m-xs text-[var(--app-muted)]">{label}</span>
                  </span>
                  <span className={`at-chip at-chip-${tone}`}>{status}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
