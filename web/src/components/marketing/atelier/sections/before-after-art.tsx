/**
 * The "before" artifacts (how rental shops run today) and the "after" screens (the same moment in
 * Drezivo). Screens are coded mockups in the business app's own charcoal-and-gold theme with
 * illustrative sample data, so they stay sharp at any size and change when the product does.
 * Each "after" has a skeleton layer that gives way to its data as the row scrolls into place.
 */
import type { ReactNode } from 'react';

/* ---------------------------------------------------------------- shared app chrome */

export function AppScreen({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <div className="at-app">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-line)] px-[1.1em] py-[0.8em]">
        <p className="at-m-md font-medium text-[var(--app-ink)]">{title}</p>
        {meta ? <p className="at-m-xs text-[var(--app-muted)]">{meta}</p> : null}
      </div>
      <div className="relative p-[1.1em]">
        <div data-ba-skeleton aria-hidden="true" className="absolute inset-4 grid content-start gap-3">
          <span className="at-skeleton h-4 w-2/3" />
          <span className="at-skeleton h-16 w-full" />
          <span className="at-skeleton h-4 w-1/2" />
          <span className="at-skeleton h-9 w-full" />
        </div>
        <div data-ba-data>{children}</div>
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: 'gold' | 'green' | 'red' | 'muted'; children: ReactNode }) {
  return <span className={`at-chip at-chip-${tone}`}>{children}</span>;
}

/* ---------------------------------------------------------------- 1. availability */

export function BeforeInquiries() {
  return (
    <div className="at-artifact at-artifact-phone">
      <p className="text-center at-m-xs text-[#5b616b]">Messenger · 11:48 PM</p>
      <div className="mt-3 grid gap-2">
        <p className="at-bubble">Hi po! Available pa po ba yung red mermaid gown sa Dec 14? 🙏</p>
        <p className="at-bubble">Size M po sana. Pwede rin po fitting this week?</p>
        <p className="at-bubble at-bubble-short">Hello po? 😅</p>
      </div>
      <p className="mt-4 flex items-center gap-2 at-m-xs text-[#5b616b]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#e5484d]" /> 4 more chats waiting
      </p>
    </div>
  );
}

export function AfterStorefront() {
  const days = [
    ['12', 'reserved'],
    ['13', 'reserved'],
    ['14', 'open'],
    ['15', 'open'],
    ['16', 'open'],
    ['17', 'cleaning'],
    ['18', 'open'],
  ] as const;
  return (
    <AppScreen title="Your storefront" meta="drezivo.shop/s/your-shop">
      <p className="at-m-md font-medium text-[var(--app-ink)]">Red Mermaid Gown · M</p>
      <p className="mt-1 at-m-xs text-[var(--app-muted)]">Renters check dates themselves, any time of day.</p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {days.map(([day, state]) => (
          <span key={day} className={`at-day at-day-${state}`}>
            <b>{day}</b>
            <small>{state === 'open' ? 'open' : state === 'cleaning' ? 'clean' : 'taken'}</small>
          </span>
        ))}
      </div>
      <p data-ba-key className="mt-3 rounded-md bg-[var(--app-accent)] py-2 text-center at-m-sm font-medium text-[#1a140d]">Reserve Dec 14 – 16</p>
    </AppScreen>
  );
}

/* ---------------------------------------------------------------- 2. double bookings */

export function BeforeNotebook() {
  return (
    <div className="at-artifact at-artifact-paper">
      <p className="at-hand at-m-xl">December</p>
      <ul className="mt-2 grid gap-1.5 at-hand at-m-lg">
        <li>13 — barong (Lim) ✓</li>
        <li>14 — red gown — Ana ✓</li>
        <li className="relative">
          14 — red gown — Bea ??
          <span aria-hidden="true" className="at-circle" />
        </li>
        <li className="line-through decoration-[#9b2c2c]">15 — fitting 3pm</li>
        <li>16 — ternos x2 …returned?</li>
      </ul>
    </div>
  );
}

export function AfterCalendar() {
  return (
    <AppScreen title="Calendar" meta="Dec 12 – 18">
      <div className="grid gap-2 at-m-xs">
        <div className="grid grid-cols-[9.5em_1fr] items-center gap-2">
          <span className="truncate text-[var(--app-muted)]">Red Mermaid · M</span>
          <span className="relative h-[2.6em] rounded-md bg-[var(--app-surface-2)]">
            <span className="absolute inset-y-1 left-[28%] w-[44%] rounded bg-[var(--app-active)] px-2 py-1 text-[var(--app-accent)]">Ana Reyes · held</span>
            <span className="absolute inset-y-1 left-[73%] w-[13%] rounded bg-[var(--app-surface-3)]" title="Cleaning" />
          </span>
        </div>
        <div className="grid grid-cols-[9.5em_1fr] items-center gap-2">
          <span className="truncate text-[var(--app-muted)]">Barong · L</span>
          <span className="relative h-[2.6em] rounded-md bg-[var(--app-surface-2)]">
            <span className="absolute inset-y-1 left-[12%] w-[30%] rounded bg-[var(--app-green-soft)] px-2 py-1 text-[var(--app-green)]">Lim · out</span>
          </span>
        </div>
      </div>
      <div data-ba-key className="mt-3 flex items-start gap-2 rounded-md border border-[var(--app-danger)]/40 bg-[var(--app-danger)]/10 p-2.5 at-m-xs text-[var(--app-ink)]">
        <span aria-hidden="true" className="mt-0.5 text-[var(--app-danger)]">●</span>
        <span>Bea Santos · Dec 14 – 16: already reserved. Suggest the Ruby Mermaid · M instead?</span>
      </div>
    </AppScreen>
  );
}

/* ---------------------------------------------------------------- 3. payment proof */

export function BeforeReceipt() {
  return (
    <div className="at-artifact at-artifact-phone">
      <p className="text-center at-m-xs text-[#5b616b]">Messenger · Yesterday</p>
      <div className="mt-3 grid justify-items-start gap-2">
        <div className="at-receipt-shot" aria-hidden="true">
          <span>GCash</span>
          <b>₱2,500.00</b>
          <i>Ref No. •••• ••• 993</i>
        </div>
        <p className="at-bubble">Sent na po! Pa-confirm na lang po 🙏</p>
        <p className="at-bubble">Para po sa debut ng anak ko</p>
      </div>
      <p className="mt-3 at-m-xs italic text-[#5b616b]">…which booking was this for?</p>
    </div>
  );
}

export function AfterPaymentReview() {
  return (
    <AppScreen title="Payments to review" meta="1 waiting">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="at-m-md font-medium text-[var(--app-ink)]">₱2,500.00 · GCash</p>
          <p className="mt-1 at-m-xs text-[var(--app-muted)]">Ref 4021 993 · RES-1042 · Carla Mendoza</p>
        </div>
        <Chip tone="gold">To review</Chip>
      </div>
      <div className="mt-3 grid grid-cols-[4.5em_1fr] gap-3 rounded-md bg-[var(--app-surface-2)] p-2.5">
        <span aria-hidden="true" className="h-[4.5em] rounded bg-[var(--app-surface-3)]" />
        <p className="at-m-xs leading-5 text-[var(--app-muted)]">
          Proof attached to the reservation. Amount matches the balance due for Dec 21 – 23.
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 at-m-sm font-medium">
        <span className="rounded-md bg-[var(--app-accent)] py-2 text-center text-[#1a140d]">Approve</span>
        <span className="rounded-md border border-[var(--app-line)] py-2 text-center text-[var(--app-ink)]">Ask again</span>
      </div>
    </AppScreen>
  );
}

/* ---------------------------------------------------------------- 4. deposits */

export function BeforeStickyNote() {
  return (
    <div className="at-artifact at-artifact-note">
      <p className="at-hand at-m-xl leading-snug">
        deposit 2k ??
        <br />
        ibinalik na ba?
        <br />
        check zipper!!
        <br />
        <span className="at-m-md">(she said may mantsa na daw before)</span>
      </p>
    </div>
  );
}

export function AfterDeposit() {
  return (
    <AppScreen title="Return · RES-1038" meta="Checked by Joy">
      <dl className="grid gap-1.5 at-m-xs">
        <div className="flex justify-between gap-3"><dt className="text-[var(--app-muted)]">At pickup</dt><dd className="text-[var(--app-ink)]">Zipper fine · no stains</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--app-muted)]">At return</dt><dd className="text-[var(--app-ink)]">Small stain on hem</dd></div>
      </dl>
      <div className="mt-3 grid gap-1.5 rounded-md bg-[var(--app-surface-2)] p-2.5 at-m-sm tabular-nums">
        <div className="flex justify-between"><span className="text-[var(--app-muted)]">Deposit held</span><span className="text-[var(--app-ink)]">₱2,000.00</span></div>
        <div className="flex justify-between"><span className="text-[var(--app-muted)]">Stain cleaning</span><span className="text-[var(--app-ink)]">− ₱300.00</span></div>
        <div className="flex justify-between border-t border-[var(--app-line)] pt-1.5 font-medium"><span className="text-[var(--app-ink)]">Refund</span><span className="text-[var(--app-green)]">₱1,700.00</span></div>
      </div>
    </AppScreen>
  );
}

/* ---------------------------------------------------------------- 5. returns */

export function BeforeMissedCalls() {
  return (
    <div className="at-artifact at-artifact-phone">
      <p className="text-center at-m-xs text-[#5b616b]">Recents · 4:12 PM</p>
      <ul className="mt-3 grid gap-2 at-m-md">
        {['Bea (gown) — 3 missed', 'Bea (gown)', 'Next client — Dec 16 fitting'].map((call, index) => (
          <li key={call} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-[#1d1d1f]">
            <span className={index === 0 ? 'text-[#c4262e]' : undefined}>{call}</span>
            <span className="at-m-xs text-[#5b616b]">{['4:02 PM', '1:15 PM', '11:40 AM'][index]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 at-m-xs italic text-[#5b616b]">Due back at 10 AM. It is past four.</p>
    </div>
  );
}

export function AfterReturns() {
  return (
    <AppScreen title="Today" meta="Thu, Dec 15">
      <p className="at-m-xs uppercase tracking-[0.2em] text-[var(--app-muted)]">Returns due</p>
      <ul className="mt-2 grid gap-2 at-m-sm">
        <li className="flex items-center justify-between gap-2 rounded-md bg-[var(--app-surface-2)] px-2.5 py-2">
          <span className="text-[var(--app-ink)]">Bea Santos · Red Mermaid</span>
          <Chip tone="red">6h late</Chip>
        </li>
        <li className="flex items-center justify-between gap-2 rounded-md bg-[var(--app-surface-2)] px-2.5 py-2">
          <span className="text-[var(--app-ink)]">Lim family · Barong ×3</span>
          <Chip tone="green">Returned</Chip>
        </li>
      </ul>
      <p className="mt-3 at-m-xs leading-5 text-[var(--app-muted)]">
        The next renter&apos;s pickup on Dec 16 keeps a one-day cleaning buffer, so the late return cannot reach her.
      </p>
    </AppScreen>
  );
}
