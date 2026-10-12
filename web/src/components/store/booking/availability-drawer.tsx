'use client';

import { useEffect, useRef, useState } from 'react';

import type { CatalogueVariant, ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { dateIn, formatDay, formatTime, minimumRentalDays, rentalDays } from '@/lib/storefront-format';

import { lockPageScroll } from '../motion/scroll';
import { AvailabilityCalendar, type DateRange, type DateRangeNotice } from './availability-calendar';
import { BookingDateNotice } from './booking-date-notice';

export function AvailabilityDrawer({
  store,
  item,
  variant,
  onClose,
}: {
  store: PublicStorefront;
  item: ItemDetail;
  variant: CatalogueVariant;
  onClose: () => void;
}) {
  const today = dateIn(store.timezone);
  const [range, setRange] = useState<DateRange | null>(null);
  const [notice, setNotice] = useState<DateRangeNotice | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const minDays = minimumRentalDays(variant);
  const days = range ? rentalDays(range.start, range.end) : 0;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const unlock = lockPageScroll();
    return () => {
      unlock();
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close availability checker"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="availability-title"
        className="relative flex h-full w-full max-w-lg flex-col bg-sf-bg shadow-2xl outline-none motion-safe:animate-[sf-drawer-in_220ms_ease-out]"
      >
        <div className="flex items-start gap-4 border-b border-sf-line p-5">
          {item.image_urls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={item.image_urls[0]} alt="" className="h-20 w-16 shrink-0 object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id="availability-title" className="truncate font-sf-display text-2xl">
              {item.name}
            </h2>
            <p className="text-sm text-sf-muted">
              {variant.size_label ? `Size ${variant.size_label} · ` : 'Flexible fit · '}
              Check date availability
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="font-sf-display text-2xl">Check availability</h3>
          <p className="mt-1 text-sm text-sf-muted">
            Choose pickup and return dates. Handover is at {formatTime(store.checkout.handover_time)}.
            {minDays > 1 ? ` Rentals are at least ${minDays} days.` : ''} Availability is advisory; contact the shop to arrange your reservation.
          </p>
          <div className="mt-5">
            <AvailabilityCalendar
              slug={store.slug}
              variantId={variant.variant_id}
              today={today}
              minDays={minDays}
              maxDays={store.checkout.max_rental_days}
              value={range}
              onChange={(nextRange, nextNotice) => {
                setRange(nextRange);
                setNotice(nextNotice ?? null);
              }}
            />
          </div>
          {notice ? (
            <div className="mt-4">
              <BookingDateNotice
                notice={notice}
                maxDays={store.checkout.max_rental_days}
                facebookUrl={store.contact.facebook_url}
                instagramUrl={store.contact.instagram_url}
              />
            </div>
          ) : null}
          {range ? (
            <p aria-live="polite" className="mt-4 border border-sf-line bg-sf-surface px-4 py-3 text-sm">
              Available for {formatDay(range.start)} → {formatDay(range.end)} · {days} day{days === 1 ? '' : 's'}. Dates are not held; contact the shop to reserve.
            </p>
          ) : !notice ? (
            <p className="mt-4 text-sm text-sf-muted" aria-live="polite">
              Select dates to check this piece.
            </p>
          ) : null}
        </div>

        <div className="border-t border-sf-line p-5">
          <button type="button" className="sf-button sf-button-outline w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
