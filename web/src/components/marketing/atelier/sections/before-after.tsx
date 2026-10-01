'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef, type ReactNode } from 'react';

import { motionAllowed } from '../motion/motion-tokens';
import {
  AfterCalendar,
  AfterDeposit,
  AfterPaymentReview,
  AfterReturns,
  AfterStorefront,
  BeforeInquiries,
  BeforeMissedCalls,
  BeforeNotebook,
  BeforeReceipt,
  BeforeStickyNote,
} from './before-after-art';

gsap.registerPlugin(ScrollTrigger);

interface Row {
  /** Reservations and the calendar are the core of the offer; their key moment gets a soft pulse. */
  core?: boolean;
  pain: string;
  title: string;
  body: string;
  fix: string;
  before: ReactNode;
  after: ReactNode;
}

const ROWS: readonly Row[] = [
  {
    core: true,
    pain: '“Available pa po?” at 11 PM',
    title: 'Renters answer their own question.',
    body: 'Every inquiry used to mean flipping through a notebook or scrolling a group chat. Your Drezivo storefront shows live availability, so renters pick open dates and send a booking while you sleep.',
    fix: 'Storefront with live availability',
    before: <BeforeInquiries />,
    after: <AfterStorefront />,
  },
  {
    core: true,
    pain: 'Two clients, one gown',
    title: 'A gown can only be promised once.',
    body: 'Overlapping dates are refused at the source, including the cleaning days after each return. You see the conflict before you say yes, with a similar piece to offer instead.',
    fix: 'Calendar with protected holds',
    before: <BeforeNotebook />,
    after: <AfterCalendar />,
  },
  {
    pain: 'Receipts buried in chat',
    title: 'Every payment lands on its booking.',
    body: 'Renters upload their GCash, Maya, or bank proof straight to the reservation. You check it once, approve it, and the booking moves on. No more matching screenshots to names.',
    fix: 'Payment proof review',
    before: <BeforeReceipt />,
    after: <AfterPaymentReview />,
  },
  {
    pain: 'Deposit arguments, no record',
    title: 'Condition is written down both ways.',
    body: 'Note the condition when a gown leaves and when it comes back. Deductions and refunds are itemised against the deposit, so the conversation is about facts, not memory.',
    fix: 'Pickup and return checks',
    before: <BeforeStickyNote />,
    after: <AfterDeposit />,
  },
  {
    pain: 'Late return, next renter waiting',
    title: 'The day is laid out before it starts.',
    body: 'Today shows every pickup, return, and fitting. Late returns stand out, and the buffer before the next booking protects the renter who comes after.',
    fix: 'Today board and return tracking',
    before: <BeforeMissedCalls />,
    after: <AfterReturns />,
  },
];

/**
 * Why shops switch: five real frictions of running a clothing rental by hand, each paired with the
 * same moment in Drezivo. On scroll the "before" fades back and the "after" screen assembles.
 */
export function BeforeAfter() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host || !motionAllowed()) return;
    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-ba-row]').forEach((row) => {
        const before = row.querySelector('[data-ba-before]');
        const after = row.querySelector('[data-ba-after]');
        const line = row.querySelector('[data-ba-line]');
        const skeleton = row.querySelector('[data-ba-skeleton]');
        const data = row.querySelector('[data-ba-data]');
        gsap
          .timeline({ scrollTrigger: { trigger: row, start: 'top 78%', end: 'center 48%', scrub: 0.6 } })
          // The before stays fully readable; it only cools a little as the after takes the stage.
          .fromTo(before, { filter: 'grayscale(0)' }, { filter: 'grayscale(0.35)', ease: 'none' }, 0)
          .fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: 'none' }, 0.05)
          .fromTo(after, { clipPath: 'inset(0% 100% 0% 0% round 24px)', y: 24 }, { clipPath: 'inset(0% 0% 0% 0% round 24px)', y: 0, ease: 'none' }, 0.12)
          .fromTo(skeleton, { autoAlpha: 1 }, { autoAlpha: 0, ease: 'none' }, 0.62)
          .fromTo(data, { autoAlpha: 0 }, { autoAlpha: 1, ease: 'none' }, 0.66);
      });
    }, host);
    return () => context.revert();
  }, []);

  return (
    <section ref={root} id="before-after" data-header="light" className="bg-atelier-paper py-at-section text-atelier-ink">
      <div className="at-container">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div data-at-reveal="lines">
            <p className="at-eyebrow text-atelier-gold-ink">Why shops switch</p>
            <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display font-normal">
              <span className="block overflow-hidden"><span data-at-line className="block">A rental shop{' '}</span></span>
              <span className="block overflow-hidden"><span data-at-line className="block">runs on memory.{' '}</span></span>
              <span className="block overflow-hidden"><span data-at-line className="block italic">Drezivo remembers.{' '}</span></span>
            </h2>
          </div>
          <p data-at-reveal="up" className="max-w-[32rem] text-at-lead text-atelier-muted lg:justify-self-end">
            These are the hassles we hear from gown, barong, and costume shops every week. Each one has a place in Drezivo, so it stops
            living in someone&apos;s head or phone.
          </p>
        </div>

        <ol className="mt-at-stack grid gap-at-section">
          {ROWS.map((row, index) => (
            <li key={row.pain} data-ba-row data-core={row.core ? '' : undefined} className="grid gap-8 sm:gap-10">
              <div data-at-reveal="up" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
                <div>
                  <p className="flex items-baseline gap-4">
                    <span className="font-[family-name:var(--font-atelier-display)] text-at-numeral text-atelier-gold">{String(index + 1).padStart(2, '0')}</span>
                    <span className="at-eyebrow text-atelier-gold-ink">{row.pain}</span>
                  </p>
                  <h3 className="mt-5 font-[family-name:var(--font-atelier-display)] text-at-subhead font-normal">{row.title}</h3>
                </div>
                <div>
                  <p className="max-w-[34rem] text-at-body text-atelier-muted">{row.body}</p>
                  <p className="mt-4 inline-flex items-center gap-3 text-at-small font-medium text-atelier-ink">
                    <span aria-hidden="true" className="h-px w-8 bg-atelier-gold" />
                    {row.fix}
                  </p>
                </div>
              </div>
              {/* Two equal stages: phones swipe between them, larger screens show them side by side. */}
              <div role="group" aria-label={`${row.fix}: before and with Drezivo`} tabIndex={0} className="at-snap-pair relative sm:grid-cols-2 sm:gap-5 lg:gap-8">
                <div data-ba-before className="at-stage at-stage-before">
                  <p className="at-eyebrow text-atelier-muted">Before<span aria-hidden="true" className="sm:hidden"> · swipe →</span></p>
                  <div className="at-stage-body">{row.before}</div>
                </div>
                <span data-ba-line aria-hidden="true" className="at-ba-line hidden sm:grid">→</span>
                <div data-ba-after className="at-stage at-stage-after">
                  <p className="at-eyebrow text-atelier-champagne">With Drezivo</p>
                  <div className="at-stage-body">{row.after}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
