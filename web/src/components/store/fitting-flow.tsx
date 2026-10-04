'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CatalogueCard, FittingSlotsResponse, GuestFittingCreated, GuestFittingRequest, ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { getFittingSlots, getItem, requestFitting, StorefrontApiError } from '@/lib/storefront-api';
import { addDays, dateIn, formatDay, formatInstant, formatMinor } from '@/lib/storefront-format';

import { Turnstile, TURNSTILE_SITE_KEY, type TurnstileHandle } from './turnstile';

interface Pick {
  productId: string;
  name: string;
  variantId: string;
  size: string | null;
}

const DAYS_AHEAD = 21;
/** Fitting times already fetched are reused for this long when switching days. */
const SLOT_TTL_MS = 60_000;

export function FittingFlow({ store, items }: { store: PublicStorefront; items: CatalogueCard[] }) {
  const today = dateIn(store.timezone);
  const dates = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, index) => addDays(today, index + 1)), [today]);
  const [date, setDate] = useState<string>(dates[0] ?? today);
  const [slots, setSlots] = useState<FittingSlotsResponse | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [choosing, setChoosing] = useState<ItemDetail | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<GuestFittingCreated | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const robotCheck = useRef<TurnstileHandle>(null);
  const [robotToken, setRobotToken] = useState<string | null>(null);
  const phoneRule = store.checkout.requirements.phone;

  // Times already fetched stay usable for a minute and the next two days load in the background, so
  // switching days is instant. The server re-checks the chosen time when the request is sent.
  const slotCache = useRef(new Map<string, { at: number; request: Promise<FittingSlotsResponse> }>());
  const loadSlots = useCallback(
    (day: string, fresh = false): Promise<FittingSlotsResponse> => {
      const hit = slotCache.current.get(day);
      if (hit && !fresh && Date.now() - hit.at < SLOT_TTL_MS) return hit.request;
      const request = getFittingSlots(store.slug, day);
      slotCache.current.set(day, { at: Date.now(), request });
      request.catch(() => slotCache.current.delete(day));
      return request;
    },
    [store.slug],
  );

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setStartAt(null);
    setSlotError(null);
    loadSlots(date)
      .then((result) => !cancelled && setSlots(result))
      .catch(() => !cancelled && setSlotError('Could not load times for this day.'));
    const next = dates.indexOf(date);
    for (const day of dates.slice(next + 1, next + 3)) loadSlots(day).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [date, dates, loadSlots]);

  async function openItem(productId: string) {
    const item = await getItem(store.slug, productId).catch(() => null);
    if (!item) return;
    if (item.variants.length === 1 && item.variants[0]) addPick(item, item.variants[0].variant_id);
    else setChoosing(item);
  }

  function addPick(item: ItemDetail, variantId: string) {
    const variant = item.variants.find((entry) => entry.variant_id === variantId);
    if (!variant || picks.length >= 3 || picks.some((pick) => pick.variantId === variantId)) return;
    setPicks([...picks, { productId: item.product_id, name: item.name, variantId, size: variant.size_label }]);
    setChoosing(null);
  }

  function problem(): string | null {
    if (!startAt) return 'Choose a time.';
    if (picks.length === 0) return 'Choose at least one piece to try.';
    if (name.trim().length < 2) return 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
    if (phoneRule === 'required' && !/^\d{11}$/.test(phone)) return 'Enter an 11-digit mobile number.';
    if (phone && !/^\d{11}$/.test(phone)) return 'Mobile numbers have 11 digits.';
    return null;
  }

  async function submit() {
    const issue = problem();
    if (issue) {
      setError(issue);
      return;
    }
    if (inFlight.current || !startAt) return;
    if (TURNSTILE_SITE_KEY && !robotToken) {
      setError('Complete the security check first.');
      return;
    }
    const body: GuestFittingRequest = {
      ...(robotToken ? { turnstile_token: robotToken } : {}),
      email: email.trim().toLowerCase(),
      customer: { full_name: name.trim(), phone: phoneRule === 'hidden' || !phone ? null : phone, address: null, social_handle: null },
      start_at: startAt,
      variant_ids: picks.map((pick) => pick.variantId) as GuestFittingRequest['variant_ids'],
      note: note.trim() || null,
    };
    const fingerprint = JSON.stringify({ ...body, turnstile_token: undefined });
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      setDone(await requestFitting(store.slug, body, intent.current.key));
    } catch (caught) {
      if (caught instanceof StorefrontApiError && caught.status === 409) {
        setStartAt(null);
        loadSlots(date, true).then(setSlots).catch(() => undefined);
      }
      setError(caught instanceof StorefrontApiError ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      inFlight.current = false;
      robotCheck.current?.reset();
      setRobotToken(null);
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-xl border border-sf-line p-8">
        <p className="font-sf-display text-4xl font-light">Fitting requested</p>
        <p className="mt-4 text-sf-muted">
          {formatInstant(done.start_at, store.timezone, { dateStyle: 'full', timeStyle: 'short' })}. Keep this page for your reference. The shop will review your request and follow up using the contact details you provided.
          {done.fee_minor ? ` The fitting fee is ${formatMinor(done.fee_minor)}, paid at the shop.` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-10">
        <section aria-labelledby="fit-day">
          <h2 id="fit-day" className="font-sf-display text-3xl font-light">1. Choose a day</h2>
          <ul className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {dates.map((day) => (
              <li key={day}>
                <button type="button" aria-pressed={day === date} onClick={() => setDate(day)} className={`flex w-16 shrink-0 flex-col items-center border py-3 text-sm ${day === date ? 'border-sf-ink bg-sf-ink text-sf-bg' : 'border-sf-line hover:border-sf-ink'}`}>
                  <span className="text-xs opacity-75">{formatDay(day, { weekday: 'short' })}</span>
                  <span className="font-sf-display text-xl">{Number(day.slice(8))}</span>
                  <span className="text-xs opacity-75">{formatDay(day, { month: 'short' })}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5" aria-live="polite">
            {slotError ? <p className="text-sm text-[#b3311f]">{slotError}</p> : null}
            {!slots && !slotError ? <p className="text-sm text-sf-muted">Loading times…</p> : null}
            {slots && slots.slots.length === 0 ? <p className="text-sm text-sf-muted">No open times this day. Try another day.</p> : null}
            {slots && slots.slots.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.slots.map((slot) => (
                  <li key={slot.start_at}>
                    <button type="button" aria-pressed={startAt === slot.start_at} onClick={() => setStartAt(slot.start_at)} className={`w-full border py-2.5 text-sm tabular-nums ${startAt === slot.start_at ? 'border-sf-ink bg-sf-ink text-sf-bg' : 'border-sf-line hover:border-sf-ink'}`}>
                      {formatInstant(slot.start_at, store.timezone, { hour: 'numeric', minute: '2-digit' })}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {slots ? <p className="mt-3 text-xs text-sf-muted">Each fitting takes {slots.duration_minutes} minutes{slots.fee_minor ? ` · ${formatMinor(slots.fee_minor)}` : ' · free'}.</p> : null}
          </div>
        </section>

        <section aria-labelledby="fit-pieces">
          <h2 id="fit-pieces" className="font-sf-display text-3xl font-light">2. Pieces to try</h2>
          <p className="mt-1 text-sm text-sf-muted">Choose up to three. The shop sets them aside if they can.</p>
          {picks.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {picks.map((pick) => (
                <li key={pick.variantId} className="flex items-center justify-between border border-sf-line px-4 py-3 text-sm">
                  <span>
                    {pick.name}
                    {pick.size ? <span className="text-sf-muted"> · {pick.size}</span> : null}
                  </span>
                  <button type="button" className="text-xs underline underline-offset-4" onClick={() => setPicks(picks.filter((entry) => entry.variantId !== pick.variantId))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {choosing ? (
            <div className="mt-4 border border-sf-ink p-4">
              <p className="text-sm">Which size of {choosing.name}?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {choosing.variants.map((variant) => (
                  <button key={variant.variant_id} type="button" onClick={() => addPick(choosing, variant.variant_id)} className="h-10 min-w-12 border border-sf-line px-3 text-sm hover:border-sf-ink">
                    {variant.size_label ?? 'One size'}
                  </button>
                ))}
                <button type="button" className="px-3 text-xs underline" onClick={() => setChoosing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {picks.length < 3 ? (
            <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {items.map((item) => (
                <li key={item.product_id}>
                  <button type="button" onClick={() => void openItem(item.product_id)} className="group block w-full text-left">
                    <span className="block aspect-[3/4] overflow-hidden bg-sf-line">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                        <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03] motion-reduce:transition-none" />
                      ) : null}
                    </span>
                    <span className="mt-1.5 block truncate text-xs">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <aside className="min-w-0 space-y-5 lg:sticky lg:top-28 lg:self-start">
        <h2 className="font-sf-display text-3xl font-light">3. Your details</h2>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email address</span>
          <input className="sf-input" type="email" inputMode="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Full name</span>
          <input className="sf-input" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {phoneRule !== 'hidden' ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Mobile number{phoneRule === 'optional' ? ' (optional)' : ''}</span>
            <input className="sf-input" inputMode="numeric" autoComplete="tel" placeholder="09171234567" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Anything the shop should know? (optional)</span>
          <textarea className="sf-input min-h-20" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <Turnstile ref={robotCheck} onToken={setRobotToken} onUnavailable={() => setError('The security check could not load. Refresh the page and try again.')} />
        <button type="button" className="sf-button sf-button-primary w-full" disabled={pending || (Boolean(TURNSTILE_SITE_KEY) && !robotToken)} onClick={() => void submit()}>
          {pending ? 'Sending…' : 'Request fitting'}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-[#b3311f]">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
