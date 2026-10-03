'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { durationLabel, formatMinor } from '@/lib/storefront-format';

import { BookingDrawer } from './booking/booking-drawer';
import { useStorePreview } from './preview-context';

type Tab = 'details' | 'measurements' | 'rental';

export function ItemView({ store, item }: { store: PublicStorefront; item: ItemDetail }) {
  const [imageIndex, setImageIndex] = useState(0);
  const [variantId, setVariantId] = useState(item.variants.length === 1 ? (item.variants[0]?.variant_id ?? null) : null);
  const [tab, setTab] = useState<Tab>('details');
  const [booking, setBooking] = useState(false);
  const variant = item.variants.find((entry) => entry.variant_id === variantId) ?? null;
  const shown = variant ?? item.variants[0];
  const preview = useStorePreview();
  // booking_open is false while the shop's subscription is view-only: the page stays browsable.
  const canBook = store.payment_methods.length > 0 && !preview && store.booking_open;
  const image = item.image_urls[imageIndex] ?? item.image_urls[0];

  return (
    <>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <div className="grid gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
          {item.image_urls.length > 1 ? (
            <ul className="order-2 flex gap-2 overflow-x-auto sm:order-1 sm:flex-col" aria-label="Photos">
              {item.image_urls.map((url, index) => (
                <li key={url} className="shrink-0">
                  <button type="button" aria-label={`Photo ${index + 1}`} aria-pressed={index === imageIndex} onClick={() => setImageIndex(index)} className={`block w-16 border sm:w-full ${index === imageIndex ? 'border-sf-ink' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                    <img src={url} alt="" className="aspect-[3/4] w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {/* First-screen content: shown immediately, never held back for a scroll reveal. */}
          <div className={`order-1 aspect-[3/4] overflow-hidden bg-sf-line sm:order-2 ${item.image_urls.length > 1 ? '' : 'sm:col-span-2'}`}>
            {image ? (
              // Keyed by URL so choosing another photo crossfades it in.
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img key={image} src={image} alt={item.name} className="h-full w-full object-cover motion-safe:animate-[sf-photo-in_500ms_ease-out]" fetchPriority="high" />
            ) : null}
          </div>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          {item.category || item.subcategory ? (
            <p className="text-sm text-sf-muted">{[item.category, item.subcategory].filter(Boolean).join(' · ')}</p>
          ) : null}
          <h1 className="mt-1 font-sf-display text-4xl font-light leading-tight sm:text-5xl">{item.name}</h1>
          {shown ? (
            <p className="mt-4 text-xl">
              <span className="tabular-nums">{formatMinor(shown.rental_price_minor)}</span>
              <span className="text-base text-sf-muted"> / {durationLabel(shown.pricing_mode, shown.included_duration_minutes)}</span>
            </p>
          ) : null}
          {shown ? <p className="mt-1 text-sm text-sf-muted">Refundable deposit {formatMinor(shown.security_deposit_minor)}</p> : null}

          {item.variants.length > 1 || item.variants[0]?.size_label ? (
            <fieldset className="mt-8">
              <legend className="mb-3 text-sm font-medium">Size</legend>
              <div className="flex flex-wrap gap-2">
                {item.variants.map((entry) => (
                  <label key={entry.variant_id} className={`flex h-11 min-w-14 cursor-pointer items-center justify-center border px-4 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-sf-accent ${variantId === entry.variant_id ? 'border-sf-ink bg-sf-ink text-sf-bg' : 'border-sf-line hover:border-sf-ink'}`}>
                    <input type="radio" name="size" className="sr-only" checked={variantId === entry.variant_id} onChange={() => setVariantId(entry.variant_id)} />
                    {entry.size_label ?? 'One size'}
                  </label>
                ))}
              </div>
              {variant?.color_label ? <p className="mt-3 text-sm text-sf-muted">Color: {variant.color_label}</p> : null}
            </fieldset>
          ) : null}

          <button type="button" className="sf-button sf-button-primary mt-8 w-full" disabled={!variant || !canBook} onClick={() => setBooking(true)}>
            {!variant ? 'Choose a size' : 'Choose rental dates'}
          </button>
          {preview ? (
            <p className="mt-3 text-sm text-sf-muted">Booking opens once you publish your storefront.</p>
          ) : !store.booking_open ? (
            <p className="mt-3 text-sm text-sf-muted">Online booking is paused for now. Contact the shop to reserve this piece.</p>
          ) : !canBook ? (
            <p className="mt-3 text-sm text-sf-muted">Online booking is not open yet. Contact the shop to reserve this piece.</p>
          ) : null}
          {store.fitting.enabled ? (
            <a href={`/s/${store.slug}/fittings`} className="mt-3 block text-center text-sm underline underline-offset-4">
              Try it on first: request a fitting
            </a>
          ) : null}

          <div className="mt-10">
            <div role="tablist" aria-label="Item information" className="flex gap-6 border-b border-sf-line text-sm">
              {(
                [
                  ['details', 'Details'],
                  ['measurements', 'Measurements'],
                  ['rental', 'Rental info'],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button key={key} role="tab" type="button" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)} className={`-mb-px border-b py-3 ${tab === key ? 'border-sf-ink' : 'border-transparent text-sf-muted hover:text-sf-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="py-5 text-sm leading-7">
              {tab === 'details' ? <p className="whitespace-pre-line text-sf-muted">{item.description ?? 'Ask the shop for more details about this piece.'}</p> : null}
              {tab === 'measurements' ? <Measurements item={item} variantId={variantId} /> : null}
              {tab === 'rental' && store.policy.format === 'images' ? (
                <p className="text-sf-muted">
                  This shop&apos;s rental terms are published as pages.{' '}
                  <Link href={`/s/${store.slug}/policies#terms`} className="text-sf-ink underline underline-offset-4">
                    Read the rental terms
                  </Link>
                </p>
              ) : tab === 'rental' ? (
                <dl className="space-y-4">
                  {[
                    ['Rental', store.policy.rental],
                    ['Deposit', store.policy.deposit],
                    ['Cancellation', store.policy.cancellation],
                    ['Damage', store.policy.damage],
                  ]
                    .filter((entry): entry is [string, string] => Boolean(entry[1]))
                    .map(([label, body]) => (
                      <div key={label}>
                        <dt className="font-medium">{label}</dt>
                        <dd className="whitespace-pre-line text-sf-muted">{body}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {booking && variant ? <BookingDrawer store={store} item={item} variant={variant} onClose={() => setBooking(false)} /> : null}
    </>
  );
}

function Measurements({ item, variantId }: { item: ItemDetail; variantId: string | null }) {
  const variant = item.variants.find((entry) => entry.variant_id === variantId) ?? item.variants[0];
  if (!variant) return null;
  const { measurement } = variant;
  if (measurement.mode === 'none') return <p className="text-sf-muted">No measurements listed. Ask the shop, or request a fitting.</p>;
  if (measurement.mode === 'default_guide') {
    return measurement.guide_image_url ? (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
      <img src={measurement.guide_image_url} alt="Size guide" className="w-full border border-sf-line" loading="lazy" />
    ) : (
      <p className="text-sf-muted">This piece follows the shop&apos;s standard size guide.</p>
    );
  }
  return (
    <>
      {!variantId && item.variants.length > 1 ? <p className="mb-3 text-sf-muted">Showing size {variant.size_label}. Choose a size to see its measurements.</p> : null}
      <dl className="divide-y divide-sf-line border-y border-sf-line">
        {measurement.values.map((value) => (
          <div key={value.label} className="flex justify-between py-2">
            <dt className="text-sf-muted">{value.label}</dt>
            <dd className="tabular-nums">{value.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-sf-muted">Approximate garment measurements.</p>
    </>
  );
}
