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
  pain: string;
  title: string;
  body: string;
  fix: string;
  before: ReactNode;
  after: ReactNode;
}

const ROWS: readonly Row[] = [
  {
    pain: '“Available pa po?” at 11 PM',
    title: 'Renters answer their own question.',
    body: 'Every inquiry used to mean flipping through a notebook or scrolling a group chat. Your Drezivo storefront shows live availability, so renters pick open dates and send a booking while you sleep.',
    fix: 'Storefront with live availability',
    before: <BeforeInquiries />,
    after: <AfterStorefront />,
  },
  {
    pain: 'Two clients, one gown',
    title: 'A gown can only be promised once.',
    body: 'Overlapping dates are refused at the source, including the cleaning days after each return. Staff see the conflict before they say yes, with a similar piece to offer instead.',
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
          .fromTo(before, { filter: 'grayscale(0) blur(0px)', opacity: 1, scale: 1, rotate: 0 }, { filter: 'grayscale(0.9) blur(1.5px)', opacity: 0.42, scale: 0.94, rotate: -2, ease: 'none' }, 0)
          .fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: 'none' }, 0.05)
          .fromTo(after, { clipPath: 'inset(0% 100% 0% 0% round 18px)', y: 24 }, { clipPath: 'inset(0% 0% 0% 0% round 18px)', y: 0, ease: 'none' }, 0.12)
          .fromTo(skeleton, { autoAlpha: 1 }, { autoAlpha: 0, ease: 'none' }, 0.62)
          .fromTo(data, { autoAlpha: 0 }, { autoAlpha: 1, ease: 'none' }, 0.66);
      });
    }, host);
    return () => context.revert();
  }, []);

  return (
    <section ref={root} id="before-after" data-header="light" className="bg-atelier-paper py-28 text-atelier-ink lg:py-40">
      <div className="at-container">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div data-at-reveal="lines">
            <p className="at-eyebrow text-atelier-gold-ink">Why shops switch</p>
            <h2 className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(2.5rem,5vw,4.5rem)] font-normal leading-[1.02] tracking-[-0.02em]">
              <span className="block overflow-hidden"><span data-at-line className="block">A rental shop{' '}</span></span>
              <span className="block overflow-hidden"><span data-at-line className="block">runs on memory.{' '}</span></span>
              <span className="block overflow-hidden"><span data-at-line className="block italic">Drezivo remembers.{' '}</span></span>
            </h2>
          </div>
          <p data-at-reveal="up" className="max-w-[32rem] text-[1.0625rem] leading-[1.75] text-atelier-muted lg:justify-self-end">
            These are the hassles we hear from gown, barong, and costume shops every week. Each one has a place in Drezivo, so it stops
            living in someone&apos;s head or phone.
          </p>
        </div>

        <ol className="mt-20 grid gap-24 lg:mt-28 lg:gap-36">
          {ROWS.map((row, index) => (
            <li key={row.pain} data-ba-row className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
              <div data-at-reveal="up">
                <p className="flex items-baseline gap-4">
                  <span className="font-[family-name:var(--font-atelier-display)] text-5xl leading-none text-atelier-gold">{String(index + 1).padStart(2, '0')}</span>
                  <span className="at-eyebrow text-atelier-gold-ink">{row.pain}</span>
                </p>
                <h3 className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(1.75rem,2.8vw,2.5rem)] font-normal leading-[1.1] tracking-[-0.01em]">
                  {row.title}
                </h3>
                <p className="mt-4 max-w-[30rem] text-[1rem] leading-[1.75] text-atelier-muted">{row.body}</p>
                <p className="mt-6 inline-flex items-center gap-3 text-sm font-medium text-atelier-ink">
                  <span aria-hidden="true" className="h-px w-8 bg-atelier-gold" />
                  {row.fix}
                </p>
              </div>
              <div className="relative grid items-center gap-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] sm:gap-0">
                <div data-ba-before className="relative z-0 sm:-mr-10 sm:translate-y-6">
                  <p className="at-eyebrow mb-3 text-[0.65rem] text-atelier-muted">Before</p>
                  {row.before}
                </div>
                <span data-ba-line aria-hidden="true" className="at-ba-line hidden sm:block" />
                <div data-ba-after className="relative z-10">
                  <p className="at-eyebrow mb-3 text-[0.65rem] text-atelier-gold-ink">With Drezivo</p>
                  {row.after}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
