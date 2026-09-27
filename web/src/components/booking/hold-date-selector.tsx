'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { BookingSteps } from '@/components/booking/booking-steps';
import { exchangeGuestCapability } from '@/lib/static-capability';
import { staticStorefrontClient } from '@/lib/static-storefront-client';
import { formatPhp, formatPhpPerUnit } from '@/lib/money';
import { useSubmitGuard } from '@/lib/use-submit-guard';

type CatalogItemDetail = NonNullable<Awaited<ReturnType<typeof staticStorefrontClient.getCatalogItem>>>;

function formatMonthParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function buildMonthGrid(visibleMonth: Date): (Date | null)[] {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();

  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  return cells;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
});
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface HoldDateSelectorProps {
  storeSlug: string;
  item: CatalogItemDetail;
  size: string;
}

/**
 * Availability remains advisory. Neutral dates are intentionally transparent,
 * selected dates use the storefront's light-gold selection token, and blocked
 * dates use the public not-available treatment. The hold request remains the
 * authoritative capacity claim.
 */
export function HoldDateSelector({ storeSlug, item, size }: HoldDateSelectorProps) {
  const router = useRouter();
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [pickupDate, setPickupDate] = useState<Date | null>(null);

  const monthParam = formatMonthParam(visibleMonth);
  const availabilityQuery = useQuery({
    queryKey: ['availability', storeSlug, item.id, monthParam],
    queryFn: () => staticStorefrontClient.getAvailability(storeSlug, item.id, monthParam),
  });

  const unavailableDates = useMemo(
    () => new Set(availabilityQuery.data?.unavailableDates ?? []),
    [availabilityQuery.data],
  );

  const returnDate = pickupDate ? addDays(pickupDate, item.rentalDurationDays) : null;
  const today = startOfToday();

  const { submit, isPending, error, resetIntent } = useSubmitGuard(async (idempotencyKey) => {
    if (!pickupDate || !returnDate) {
      throw new Error('Select a rental start date first.');
    }

    const hold = await staticStorefrontClient.createHold(
      storeSlug,
      {
        itemId: item.id,
        variantId: item.variantId,
        size,
        pickupDate: toIsoDate(pickupDate),
        returnDate: toIsoDate(returnDate),
      },
      idempotencyKey,
    );

    await exchangeGuestCapability(hold.capabilityToken);
    return hold;
  });

  async function handleContinue() {
    const hold = await submit();
    if (!hold) return;
    router.push(`/s/${storeSlug}/book/${item.id}/details?rid=${hold.reservationId}`);
  }

  function handleSelectDate(date: Date) {
    setPickupDate(date);
    resetIntent();
  }

  function handleClose() {
    router.push(`/s/${storeSlug}/items/${item.id}`);
  }

  const monthCells = buildMonthGrid(visibleMonth);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-storefront-overlay backdrop-blur-[1px]">
      <button
        type="button"
        aria-label="Close date selection"
        className="absolute inset-0 cursor-default"
        onClick={handleClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Select rental dates"
        className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-storefront-paper shadow-2xl"
      >
        <div className="border-b border-storefront-line px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-md bg-storefront-soft">
                {item.images[0] ? (
                  <Image src={item.images[0]} alt="" fill sizes="56px" className="object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-semibold text-storefront-ink">
                  {item.name}
                </p>
                <p className="mt-1 text-sm text-storefront-muted">
                  {item.categoryName} · {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
                </p>
                <p className="mt-1 text-xs text-storefront-muted">
                  Security Deposit: {formatPhp(item.securityDepositDecimal)} refundable
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-2xl text-storefront-ink transition hover:bg-storefront-soft"
            >
              ×
            </button>
          </div>

          <div className="mt-6">
            <BookingSteps current={1} />
          </div>
        </div>

        <div className="flex-1 px-6 py-7 sm:px-8">
          <h1 className="font-display text-3xl font-semibold text-storefront-ink">
            Select Rental Dates
          </h1>
          <p className="mt-2 text-sm leading-6 text-storefront-muted">
            Choose your preferred rental period. Dates without a color are currently open for
            selection.
          </p>

          <div className="mt-6 rounded-md border border-storefront-line bg-storefront-paper p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() =>
                  setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))
                }
                className="grid h-11 w-11 place-items-center rounded-md text-2xl text-storefront-ink transition hover:bg-storefront-soft"
              >
                ‹
              </button>
              <p className="font-semibold text-storefront-ink">
                {MONTH_LABEL_FORMATTER.format(visibleMonth)}
              </p>
              <button
                type="button"
                aria-label="Next month"
                onClick={() =>
                  setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))
                }
                className="grid h-11 w-11 place-items-center rounded-md text-2xl text-storefront-ink transition hover:bg-storefront-soft"
              >
                ›
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-medium text-storefront-muted">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="py-1">
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-2">
              {monthCells.map((date, index) => {
                if (!date) return <span key={`blank-${index}`} className="aspect-square" />;

                const iso = toIsoDate(date);
                const isPast = date < today;
                const isUnavailable = unavailableDates.has(iso);
                const isSelected =
                  pickupDate && returnDate ? date >= pickupDate && date <= returnDate : false;
                const isDisabled = isPast || isUnavailable;

                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelectDate(date)}
                    aria-pressed={Boolean(isSelected)}
                    aria-label={`${formatDisplayDate(date)}${
                      isUnavailable ? ', not available' : isSelected ? ', selected' : ''
                    }`}
                    className={`aspect-square rounded-full border text-sm transition ${
                      isUnavailable
                        ? 'border-storefront-unavailable bg-storefront-unavailable text-storefront-unavailable-ink'
                        : isSelected
                          ? 'border-storefront-selected bg-storefront-selected text-storefront-selected-ink'
                          : isPast
                            ? 'border-transparent bg-transparent text-storefront-muted/35'
                            : 'border-transparent bg-transparent text-storefront-ink hover:border-storefront-line hover:bg-storefront-soft'
                    }`}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-storefront-line pt-4 text-xs text-storefront-muted">
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full border border-storefront-selected bg-storefront-selected"
                  aria-hidden="true"
                />
                Selected
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full border border-storefront-unavailable bg-storefront-unavailable"
                  aria-hidden="true"
                />
                Not Available
              </span>
            </div>
          </div>

          {pickupDate && returnDate ? (
            <div className="mt-4 rounded-md border border-storefront-line bg-storefront-soft p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-storefront-ink">Selected Dates</p>
                  <p className="mt-1 text-sm text-storefront-ink">
                    {formatDisplayDate(pickupDate)} → {formatDisplayDate(returnDate)}
                  </p>
                  <p className="mt-1 text-xs text-storefront-muted">
                    {item.rentalDurationDays} day{item.rentalDurationDays === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickupDate(null);
                    resetIntent();
                  }}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-storefront-brand hover:underline"
                >
                  Edit
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-storefront-line bg-storefront-paper px-6 py-5 sm:px-8">
          <button
            type="button"
            disabled={!pickupDate || isPending}
            onClick={handleContinue}
            className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-storefront-brand px-5 text-sm font-semibold text-storefront-paper transition hover:bg-storefront-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Reserving…' : 'Continue'}
            {!isPending ? <span aria-hidden="true">→</span> : null}
          </button>
          <p className="mt-3 text-center text-xs text-storefront-muted">
            Availability can change until your reservation hold is created.
          </p>
        </div>
      </aside>
    </div>
  );
}
