'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { CatalogItemDetail } from '@drezivo/contracts';
import { publicApiClient } from '@/lib/api-client';
import { exchangeGuestCapability } from '@/lib/capability';
import { useSubmitGuard } from '@/lib/use-submit-guard';
import { Button } from '@/components/ui/button';
import { formatPhp } from '@/lib/money';

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
 * THE reference booking step: availability + date selection, ending in a
 * hold POST. Every later step in this flow (details, review) is copied from
 * this component's pattern — same `useSubmitGuard` usage, same "server is
 * the only source of truth for price" discipline, same capability-exchange
 * handoff.
 *
 * Availability here is advisory only (Drezivo-TRD.md §5): a day shown green
 * can still lose a capacity race to another customer between this render and
 * the hold POST. The hold response — not this calendar — is the actual
 * capacity claim, enforced by a database exclusion constraint server-side.
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
    queryFn: () => publicApiClient.getAvailability(storeSlug, item.id, monthParam),
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

    // Step 1 of the guest hold transaction (Drezivo-TRD.md §5 "Hold
    // transaction"): this call locks the physical asset for these dates and
    // starts the 15-minute hold window. The server recomputes price and
    // validates the dates — this component never sends a total.
    const hold = await publicApiClient.createHold(
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

    // Exchange the one-time capability secret for an HttpOnly cookie right
    // away. It is never stored in component state, a URL, or localStorage
    // beyond this single call — see src/lib/capability.ts for why.
    await exchangeGuestCapability(hold.capabilityToken);

    return hold;
  });

  async function handleContinue() {
    const hold = await submit();
    if (!hold) return; // Guard dropped a duplicate tap, or the attempt threw and was surfaced via `error`.
    router.push(`/s/${storeSlug}/book/${item.id}/details?rid=${hold.reservationId}`);
  }

  function handleSelectDate(date: Date) {
    setPickupDate(date);
    // The user changed the underlying intent (a different start date), so
    // the next hold attempt must use a fresh idempotency key — reusing the
    // old key here could make the server treat this new selection as a
    // retry of the previous one.
    resetIntent();
  }

  const monthCells = buildMonthGrid(visibleMonth);

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">Select Rental Dates</h2>
      <p className="mt-1 text-sm text-muted">
        Choose your preferred start date. Only available dates can be selected.
      </p>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() =>
            setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          ‹
        </button>
        <p className="font-medium text-foreground">{MONTH_LABEL_FORMATTER.format(visibleMonth)}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() =>
            setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          ›
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {monthCells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;

          const iso = toIsoDate(date);
          const isPast = date < today;
          const isUnavailable = unavailableDates.has(iso);
          const isSelected = pickupDate ? toIsoDate(pickupDate) === iso : false;
          const isInRange =
            pickupDate && returnDate ? date > pickupDate && date < returnDate : false;
          const isDisabled = isPast || isUnavailable;

          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => handleSelectDate(date)}
              aria-pressed={isSelected}
              className={`aspect-square rounded-full text-sm ${
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : isInRange
                    ? 'bg-primary/10 text-foreground'
                    : isDisabled
                      ? 'text-muted/40 line-through'
                      : 'text-foreground hover:bg-border'
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" /> Selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-muted/30" aria-hidden="true" /> Not available
        </span>
      </div>

      {pickupDate && returnDate ? (
        <div className="mt-5 rounded-md border border-border bg-background p-4 text-sm">
          <p className="font-medium text-foreground">
            {toIsoDate(pickupDate)} → {toIsoDate(returnDate)}
          </p>
          <p className="mt-1 text-muted">
            {item.rentalDurationDays} day{item.rentalDurationDays === 1 ? '' : 's'} · Rental fee{' '}
            {formatPhp(item.priceDecimal)} · Security deposit {formatPhp(item.securityDepositDecimal)}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error.message}
        </p>
      ) : null}

      <Button
        className="mt-6 w-full"
        disabled={!pickupDate || isPending}
        isLoading={isPending}
        onClick={handleContinue}
      >
        Continue
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        This reserves the item for 15 minutes while you complete your details.
      </p>
    </div>
  );
}
