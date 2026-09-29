'use client';

import Link from 'next/link';
import { useEffect, useReducer, useRef } from 'react';

import type { CatalogueVariant, FulfillmentMethod, GuestReservationRequest, GuestReservationView, ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { createReservation, StorefrontApiError } from '@/lib/storefront-api';
import { dateIn, daysBetween, formatDay, formatMinor, formatTime, zonedInstant } from '@/lib/storefront-format';

import { AvailabilityCalendar, type DateRange } from './availability-calendar';
import { EmailVerification, type VerifiedEmail } from './email-verification';
import { MoneyBreakdown, PaymentStep } from './payment-step';

type Step = 'dates' | 'details' | 'review' | 'pay' | 'done';

interface Customer {
  full_name: string;
  phone: string;
  address: string;
  social_handle: string;
  event_date: string;
}

interface State {
  step: Step;
  range: DateRange | null;
  notice: string | null;
  verified: VerifiedEmail | null;
  customer: Customer;
  fulfillment: FulfillmentMethod;
  paymentMethodId: string | null;
  accepted: boolean;
  pending: boolean;
  error: string | null;
  reservation: GuestReservationView | null;
  token: string | null;
}

type Action =
  | { type: 'range'; range: DateRange | null; notice?: string | undefined }
  | { type: 'step'; step: Step }
  | { type: 'verified'; value: VerifiedEmail | null }
  | { type: 'customer'; patch: Partial<Customer> }
  | { type: 'set'; patch: Partial<Pick<State, 'fulfillment' | 'paymentMethodId' | 'accepted'>> }
  | { type: 'pending'; value: boolean }
  | { type: 'error'; message: string | null; step?: Step }
  | { type: 'held'; reservation: GuestReservationView; token: string }
  | { type: 'submitted'; reservation: GuestReservationView };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'range':
      return { ...state, range: action.range, notice: action.notice ?? null };
    case 'step':
      return { ...state, step: action.step, error: null };
    case 'verified':
      return { ...state, verified: action.value };
    case 'customer':
      return { ...state, customer: { ...state.customer, ...action.patch } };
    case 'set':
      return { ...state, ...action.patch };
    case 'pending':
      return { ...state, pending: action.value };
    case 'error':
      return { ...state, error: action.message, ...(action.step ? { step: action.step } : {}) };
    case 'held':
      return { ...state, reservation: action.reservation, token: action.token, step: 'pay', error: null };
    case 'submitted':
      return { ...state, reservation: action.reservation, step: 'done' };
  }
}

/** Display-only estimate before the hold; the exact amount comes back from the server on the pay step. */
function estimateRentalMinor(variant: CatalogueVariant, days: number): bigint {
  if (variant.pricing_mode === 'daily') return BigInt(variant.rental_price_minor) * BigInt(days);
  return BigInt(variant.rental_price_minor) + BigInt(Math.max(0, days - minimumRentalDays(variant))) * BigInt(variant.extra_day_price_minor);
}

/** A fixed-duration price covers its included days, which is also the shortest rental the server accepts. */
function minimumRentalDays(variant: CatalogueVariant): number {
  return variant.pricing_mode === 'fixed_duration' ? Math.max(1, Math.ceil(variant.included_duration_minutes / 1440)) : 1;
}

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'dates', label: 'Dates' },
  { key: 'details', label: 'Details' },
  { key: 'review', label: 'Review' },
  { key: 'pay', label: 'Pay' },
];

export function BookingDrawer({ store, item, variant, onClose }: { store: PublicStorefront; item: ItemDetail; variant: CatalogueVariant; onClose: () => void }) {
  const today = dateIn(store.timezone);
  const [state, dispatch] = useReducer(reducer, {
    step: 'dates',
    range: null,
    notice: null,
    verified: null,
    customer: { full_name: '', phone: '', address: '', social_handle: '', event_date: '' },
    fulfillment: 'pickup',
    paymentMethodId: store.payment_methods[0]?.id ?? null,
    accepted: false,
    pending: false,
    error: null,
    reservation: null,
    token: null,
  });
  const panel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const requirements = store.checkout.requirements;
  const days = state.range ? daysBetween(state.range.start, state.range.end) : 0;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, []);

  function requestClose() {
    if (state.pending) return;
    if (state.step === 'pay' && !window.confirm('Leave without sending your receipt? Your size stays held only until the timer runs out.')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function detailsProblem(): string | null {
    const c = state.customer;
    if (!state.verified) return 'Verify your email first.';
    if (c.full_name.trim().length < 2) return 'Enter your full name.';
    if (requirements.phone === 'required' && !/^\d{11}$/.test(c.phone)) return 'Enter an 11-digit mobile number, e.g. 09171234567.';
    if (c.phone && !/^\d{11}$/.test(c.phone)) return 'Mobile numbers have 11 digits, e.g. 09171234567.';
    if (c.address.trim().length < 5) return 'Enter the address for this rental.';
    if (requirements.social_handle === 'required' && !c.social_handle.trim()) return 'Add your Instagram or Facebook.';
    if (requirements.event_date === 'required' && !c.event_date) return 'Add your event date.';
    if (c.event_date && state.range && (c.event_date < state.range.start || c.event_date > state.range.end)) return 'The event date must be within your rental dates.';
    if (!state.paymentMethodId) return 'This shop has no online payment method yet. Contact the shop to book.';
    return null;
  }

  async function placeHold() {
    if (inFlight.current || !state.range || !state.verified || !state.paymentMethodId || !state.accepted) return;
    const c = state.customer;
    const request: GuestReservationRequest = {
      verification_token: state.verified.token,
      email: state.verified.email,
      customer: {
        full_name: c.full_name.trim(),
        phone: requirements.phone === 'hidden' || !c.phone ? null : c.phone,
        address: c.address.trim(),
        social_handle: requirements.social_handle === 'hidden' || !c.social_handle.trim() ? null : c.social_handle.trim(),
      },
      variant_id: variant.variant_id,
      requested_interval: {
        start: zonedInstant(state.range.start, store.checkout.handover_time, store.timezone),
        end: zonedInstant(state.range.end, store.checkout.handover_time, store.timezone),
      },
      event_date: requirements.event_date === 'hidden' || !c.event_date ? null : c.event_date,
      fulfillment_method: state.fulfillment,
      payment_method_id: state.paymentMethodId as GuestReservationRequest['payment_method_id'],
    };
    const fingerprint = JSON.stringify(request);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };

    inFlight.current = true;
    dispatch({ type: 'pending', value: true });
    try {
      const created = await createReservation(store.slug, request, intent.current.key);
      dispatch({ type: 'held', reservation: created.reservation, token: created.guest_token });
    } catch (caught) {
      if (caught instanceof StorefrontApiError && caught.status === 409) {
        // The server says why the dates were refused (taken meanwhile, minimum length, notice period).
        dispatch({ type: 'range', range: null, notice: caught.message });
        dispatch({ type: 'error', message: null, step: 'dates' });
      } else if (caught instanceof StorefrontApiError && caught.status === 401) {
        dispatch({ type: 'verified', value: null });
        dispatch({ type: 'error', message: caught.message, step: 'details' });
      } else {
        dispatch({ type: 'error', message: caught instanceof StorefrontApiError ? caught.message : 'Something went wrong. Please try again.' });
      }
    } finally {
      inFlight.current = false;
      dispatch({ type: 'pending', value: false });
    }
  }

  const rental = state.range ? estimateRentalMinor(variant, days) : 0n;
  const delivery = state.fulfillment === 'delivery' ? BigInt(store.fulfillment.delivery_fee_minor) : 0n;
  const estimate = rental + BigInt(variant.security_deposit_minor) + delivery;
  const stepIndex = STEPS.findIndex((step) => step.key === state.step);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button type="button" aria-label="Close booking" className="absolute inset-0 bg-black/40" onClick={requestClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="booking-title" className="relative flex h-full w-full max-w-lg flex-col bg-sf-bg shadow-2xl outline-none motion-safe:animate-[sf-drawer-in_220ms_ease-out]">
        <div className="flex items-start gap-4 border-b border-sf-line p-5">
          {item.image_urls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={item.image_urls[0]} alt="" className="h-20 w-16 shrink-0 object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id="booking-title" className="truncate font-sf-display text-2xl">
              {item.name}
            </h2>
            <p className="text-sm text-sf-muted">
              {variant.size_label ? `Size ${variant.size_label} · ` : ''}
              {formatMinor(variant.rental_price_minor)} · deposit {formatMinor(variant.security_deposit_minor)}
            </p>
          </div>
          <button type="button" onClick={requestClose} className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {state.step !== 'done' ? (
          <ol className="flex gap-2 border-b border-sf-line px-5 py-3 text-xs" aria-label="Booking steps">
            {STEPS.map((step, index) => (
              <li key={step.key} aria-current={index === stepIndex ? 'step' : undefined} className={`flex-1 border-t-2 pt-2 ${index <= stepIndex ? 'border-sf-ink text-sf-ink' : 'border-sf-line text-sf-muted'}`}>
                {step.label}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="flex-1 overflow-y-auto p-5">
          {state.step === 'dates' ? (
            <div className="space-y-5">
              <div>
                <h3 className="font-sf-display text-2xl">Choose your dates</h3>
                <p className="mt-1 text-sm text-sf-muted">
                  Tap your pickup date, then your return date. Handover is at {formatTime(store.checkout.handover_time)}.
                  {minimumRentalDays(variant) > 1 ? ` Rentals are at least ${minimumRentalDays(variant)} days.` : ''}
                </p>
              </div>
              <AvailabilityCalendar
                slug={store.slug}
                variantId={variant.variant_id}
                today={today}
                minDays={minimumRentalDays(variant)}
                maxDays={store.checkout.max_rental_days}
                value={state.range}
                onChange={(range, notice) => dispatch({ type: 'range', range, notice })}
              />
              {state.notice ? (
                <p role="alert" className="text-sm text-[#b3311f]">
                  {state.notice}
                </p>
              ) : null}
              {state.range ? (
                <p className="border border-sf-line bg-sf-surface px-4 py-3 text-sm">
                  {formatDay(state.range.start)} → {formatDay(state.range.end)} · {days} day{days === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          ) : null}

          {state.step === 'details' ? (
            <div className="space-y-5">
              <h3 className="font-sf-display text-2xl">Your details</h3>
              <div>
                <p className="mb-2 text-sm font-medium">Email</p>
                <EmailVerification slug={store.slug} verified={state.verified} onVerified={(value) => dispatch({ type: 'verified', value })} />
              </div>
              <TextField label="Full name" autoComplete="name" value={state.customer.full_name} onChange={(full_name) => dispatch({ type: 'customer', patch: { full_name } })} />
              {requirements.phone !== 'hidden' ? (
                <TextField label={`Mobile number${requirements.phone === 'optional' ? ' (optional)' : ''}`} autoComplete="tel" inputMode="numeric" placeholder="09171234567" value={state.customer.phone} onChange={(phone) => dispatch({ type: 'customer', patch: { phone: phone.replace(/\D/g, '').slice(0, 11) } })} />
              ) : null}
              <TextField label="Address" autoComplete="street-address" multiline value={state.customer.address} onChange={(address) => dispatch({ type: 'customer', patch: { address } })} />
              {requirements.social_handle !== 'hidden' ? (
                <TextField label={`Instagram or Facebook${requirements.social_handle === 'optional' ? ' (optional)' : ''}`} placeholder="@yourname" value={state.customer.social_handle} onChange={(social_handle) => dispatch({ type: 'customer', patch: { social_handle } })} />
              ) : null}
              {requirements.event_date !== 'hidden' ? (
                <TextField label={`Event date${requirements.event_date === 'optional' ? ' (optional)' : ''}`} type="date" min={state.range?.start} max={state.range?.end} value={state.customer.event_date} onChange={(event_date) => dispatch({ type: 'customer', patch: { event_date } })} />
              ) : null}

              {store.fulfillment.delivery ? (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Pickup or delivery</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['pickup', 'delivery'] as const).map((method) => (
                      <Choice key={method} name="fulfillment" checked={state.fulfillment === method} onSelect={() => dispatch({ type: 'set', patch: { fulfillment: method } })}>
                        {method === 'pickup' ? 'Pick up at the shop' : `Delivery${store.fulfillment.delivery_fee_minor !== '0' ? ` · ${formatMinor(store.fulfillment.delivery_fee_minor)}` : ''}`}
                      </Choice>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {store.payment_methods.length > 1 ? (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Payment method</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {store.payment_methods.map((method) => (
                      <Choice key={method.id} name="payment" checked={state.paymentMethodId === method.id} onSelect={() => dispatch({ type: 'set', patch: { paymentMethodId: method.id } })}>
                        {method.name}
                      </Choice>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null}

          {state.step === 'review' && state.range ? (
            <div className="space-y-6">
              <h3 className="font-sf-display text-2xl">Review your request</h3>
              <dl className="space-y-2 text-sm">
                <Row label="Dates" value={`${formatDay(state.range.start)} → ${formatDay(state.range.end)}`} />
                <Row label="Handover" value={`${formatTime(store.checkout.handover_time)}, pickup and return`} />
                <Row label="Size" value={variant.size_label ?? 'One size'} />
                <Row label="Name" value={state.customer.full_name} />
                <Row label="Email" value={state.verified?.email ?? ''} />
                <Row label={state.fulfillment === 'delivery' ? 'Delivery to' : 'Address'} value={state.customer.address} />
                <Row label="Payment" value={store.payment_methods.find((method) => method.id === state.paymentMethodId)?.name ?? ''} />
              </dl>
              <dl className="space-y-2 border-t border-sf-line pt-4 text-sm">
                <Row label={`Rental · ${days} day${days === 1 ? '' : 's'}`} value={formatMinor(rental.toString())} />
                <Row label="Refundable deposit" value={formatMinor(variant.security_deposit_minor)} />
                {delivery > 0n ? <Row label="Delivery" value={formatMinor(delivery.toString())} /> : null}
                <div className="flex justify-between gap-4 border-t border-sf-line pt-2 font-medium">
                  <dt>Estimated total</dt>
                  <dd className="tabular-nums">{formatMinor(estimate.toString())}</dd>
                </div>
                <p className="text-xs text-sf-muted">The exact amount is confirmed on the next step, before you pay.</p>
              </dl>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--sf-accent)]" checked={state.accepted} onChange={(event) => dispatch({ type: 'set', patch: { accepted: event.target.checked } })} />
                <span>
                  I accept the{' '}
                  <Link href={`/s/${store.slug}/policies`} target="_blank" className="underline underline-offset-4">
                    rental terms and privacy notice
                  </Link>{' '}
                  (version {store.policy.version}). My size is held for 15 minutes while I pay.
                </span>
              </label>
            </div>
          ) : null}

          {state.step === 'pay' && state.reservation && state.token ? (
            <PaymentStep reservation={state.reservation} token={state.token} onSubmitted={(reservation) => dispatch({ type: 'submitted', reservation })} />
          ) : null}

          {state.step === 'done' && state.reservation && state.token ? (
            <div className="space-y-5 py-4">
              <p className="font-sf-display text-4xl font-light">Request sent</p>
              <p className="text-sf-muted">
                {store.name} is reviewing your request and receipt. Your size stays held meanwhile, and you will get an email when they confirm.
              </p>
              <dl className="space-y-2 border-y border-sf-line py-4 text-sm">
                <Row label="Reference" value={state.reservation.reference_code.slice(0, 12)} />
                <Row label="Dates" value={state.range ? `${formatDay(state.range.start)} → ${formatDay(state.range.end)}` : ''} />
              </dl>
              <MoneyBreakdown reservation={state.reservation} />
              <Link href={`/s/${store.slug}/booking#${state.reservation.id}.${state.token}`} className="sf-button sf-button-outline w-full">
                View request status
              </Link>
              <p className="text-xs text-sf-muted">Bookmark that page or keep the email. Anyone with the link can see this request, so do not share it.</p>
            </div>
          ) : null}

          {state.error ? (
            <p role="alert" className="mt-4 text-sm text-[#b3311f]">
              {state.error}
            </p>
          ) : null}
        </div>

        {state.step === 'dates' || state.step === 'details' || state.step === 'review' ? (
          <div className="flex gap-3 border-t border-sf-line p-5">
            {state.step !== 'dates' ? (
              <button type="button" className="sf-button sf-button-outline" disabled={state.pending} onClick={() => dispatch({ type: 'step', step: state.step === 'review' ? 'details' : 'dates' })}>
                Back
              </button>
            ) : null}
            {state.step === 'dates' ? (
              <button type="button" className="sf-button sf-button-primary flex-1" disabled={!state.range} onClick={() => dispatch({ type: 'step', step: 'details' })}>
                Continue
              </button>
            ) : state.step === 'details' ? (
              <button
                type="button"
                className="sf-button sf-button-primary flex-1"
                onClick={() => {
                  const problem = detailsProblem();
                  if (problem) dispatch({ type: 'error', message: problem });
                  else dispatch({ type: 'step', step: 'review' });
                }}
              >
                Review request
              </button>
            ) : (
              <button type="button" className="sf-button sf-button-primary flex-1" disabled={!state.accepted || state.pending} onClick={() => void placeHold()}>
                {state.pending ? 'Holding your size…' : 'Hold my size and pay'}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A radio tile. The native input stays in the label, so clicks, arrow keys, and screen readers work. */
function Choice({ name, checked, onSelect, children }: { name: string; checked: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`relative flex min-h-12 cursor-pointer items-center border px-4 py-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-sf-accent ${
        checked ? 'border-sf-ink bg-sf-ink text-sf-bg' : 'border-sf-line hover:border-sf-ink'
      }`}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onSelect} />
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-sf-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {multiline ? (
        <textarea className="sf-input min-h-20" rows={2} maxLength={500} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="sf-input" maxLength={200} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
      )}
    </label>
  );
}
