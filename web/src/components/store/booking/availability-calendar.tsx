'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PublicDayState } from '@drezivo/contracts';

import { getAvailability } from '@/lib/storefront-api';
import { addDays, formatDay, rentalDays } from '@/lib/storefront-format';

export interface DateRange {
  start: string;
  end: string;
}

export type DateRangeNotice =
  | { reason: 'max_rental_days'; message: string }
  | { reason: 'other'; message: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A closed day is not blocked (a rental may run across it); the shop just cannot hand over that day. */
const CLOSED_STYLE = 'bg-sf-line/40 text-sf-muted/70 cursor-not-allowed';

const STATE_STYLE: Record<PublicDayState, string> = {
  available: 'hover:bg-sf-line/70',
  reserved: 'bg-[#F4E6C9] text-[#6B4E12] cursor-not-allowed',
  fitting: 'bg-[#E9E4F6] text-[#4B3F7A] cursor-not-allowed',
  unavailable: 'text-sf-muted/60 line-through cursor-not-allowed',
};

function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

function shiftMonth(month: string, delta: number): string {
  const [year = 0, value = 1] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * Day states for this variant, loaded one visible month at a time and shared by the main calendar
 * and the linked date controls, so the active calendar month is fetched once per variant.
 */
function useMonthAvailability(slug: string, variantId: string) {
  const [states, setStates] = useState<Record<string, PublicDayState>>({});
  const [closedDays, setClosedDays] = useState<ReadonlySet<string>>(new Set());
  const [loadingMonths, setLoadingMonths] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    requested.current = new Set();
    setStates({});
    setClosedDays(new Set());
    setError(null);
  }, [slug, variantId]);

  const ensureMonth = useCallback(
    (month: string) => {
      if (requested.current.has(month)) return;
      requested.current.add(month);
      const grid = monthGrid(month);
      setLoadingMonths((current) => new Set(current).add(month));
      getAvailability(slug, variantId, grid[0]!, grid[grid.length - 1]!)
        .then((result) => {
          setStates((current) => ({ ...current, ...Object.fromEntries(result.days.map((day) => [day.date, day.state])) }));
          setClosedDays((current) => new Set([...current, ...result.days.filter((day) => day.closed).map((day) => day.date)]));
          setError(null);
        })
        .catch(() => {
          // Allow a retry the next time this month is shown.
          requested.current.delete(month);
          setError('Could not load availability. Try again in a moment.');
        })
        .finally(() => {
          setLoadingMonths((current) => {
            const next = new Set(current);
            next.delete(month);
            return next;
          });
        });
    },
    [slug, variantId],
  );

  const stateOf = useCallback((date: string): PublicDayState => states[date] ?? 'unavailable', [states]);
  const isClosed = useCallback((date: string): boolean => closedDays.has(date), [closedDays]);
  return { stateOf, isClosed, ensureMonth, loadingMonths, error };
}

function MonthGrid({
  month,
  today,
  onMonthChange,
  stateOf,
  isClosed,
  loading,
  isSelected,
  isEdge,
  onPick,
  minimumDate,
}: {
  month: string;
  today: string;
  onMonthChange: (month: string) => void;
  stateOf: (date: string) => PublicDayState;
  isClosed: (date: string) => boolean;
  loading: boolean;
  isSelected: (date: string) => boolean;
  isEdge: (date: string) => boolean;
  onPick: (date: string) => void;
  minimumDate?: string;
}) {
  const days = useMemo(() => monthGrid(month), [month]);
  const canGoBack = month > today.slice(0, 7);

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-10 w-10 items-center justify-center disabled:opacity-30" disabled={!canGoBack} onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <p className="font-sf-display text-xl" aria-live="polite">
          {monthLabel(month)}
        </p>
        <button type="button" className="flex h-10 w-10 items-center justify-center" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      <div role="grid" aria-label={`Availability for ${monthLabel(month)}`} aria-busy={loading} className={`mt-2 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <div role="row" className="grid grid-cols-7 text-center text-xs text-sf-muted">
          {WEEKDAYS.map((day) => (
            <span role="columnheader" key={day} className="py-2">
              {day}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-y-1">
            {days.slice(week * 7, week * 7 + 7).map((date) => {
              const outside = date.slice(0, 7) !== month;
              const state = date < today ? 'unavailable' : stateOf(date);
              const tooEarly = Boolean(minimumDate && date < minimumDate && date >= today && state === 'available');
              const selected = isSelected(date);
              // Only an otherwise bookable day is shown as "closed"; a reserved closed day stays reserved.
              const closed = state === 'available' && isClosed(date);
              if (outside) return <span role="gridcell" key={date} aria-hidden="true" />;
              return (
                <span role="gridcell" key={date} className="flex justify-center">
                  <button
                    type="button"
                    disabled={state !== 'available' || closed || tooEarly}
                    aria-pressed={selected}
                    aria-label={`${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${tooEarly ? 'too early for return' : closed ? 'shop closed' : state === 'available' ? 'available' : state}`}
                    onClick={() => onPick(date)}
                    className={[
                      'flex h-10 w-full max-w-11 items-center justify-center text-sm tabular-nums transition-colors',
                      selected && isEdge(date) ? 'bg-sf-accent text-sf-accent-ink' : selected ? 'bg-sf-line' : closed ? CLOSED_STYLE : tooEarly ? STATE_STYLE.unavailable : STATE_STYLE[state],
                    ].join(' ')}
                  >
                    {Number(date.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pick pickup then return on the calendar, or select either date target below it; both stay in
 * step. Only days the API reports as available can be part of a range, and the pickup and return
 * days must also be days the shop is open (days in between may be closed). The server re-checks
 * everything when the hold is placed, so this is guidance, not a guarantee.
 */
export function AvailabilityCalendar({
  slug,
  variantId,
  today,
  minDays,
  maxDays,
  value,
  onChange,
}: {
  slug: string;
  variantId: string;
  today: string;
  /** Fixed-duration pieces rent for at least their included days; the server enforces the same rule. */
  minDays: number;
  maxDays: number;
  value: DateRange | null;
  onChange: (range: DateRange | null, notice?: DateRangeNotice) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<'from' | 'to'>('from');
  const availability = useMonthAvailability(slug, variantId);
  const { stateOf, isClosed, ensureMonth, loadingMonths, error } = availability;

  useEffect(() => ensureMonth(month), [month, ensureMonth]);
  useEffect(() => {
    setAnchor(null);
    setEditing('from');
  }, [variantId]);

  const pickupDate = value?.start ?? anchor;
  // The pickup date is Day 1 and a storefront rental spans at least one night (pickup and return
  // share one handover time), so the earliest return is pickup + max(minDays - 1, 1) days.
  const minimumNights = Math.max(minDays - 1, 1);

  /** Why a range cannot be booked, or null when it can. Mirrors the server's checkout rules. */
  function rangeProblem(start: string, end: string): DateRangeNotice | null {
    const length = rentalDays(start, end);
    if (end <= start || length < minDays) {
      return { reason: 'other', message: `This piece rents for at least ${Math.max(minDays, 2)} days, counting the pickup date as Day 1. Choose a later return date.` };
    }
    if (length > maxDays) return { reason: 'max_rental_days', message: `The longest rental allowed is ${maxDays} day${maxDays === 1 ? '' : 's'}.` };
    for (const handover of [start, end]) {
      if (isClosed(handover)) {
        return { reason: 'other', message: `The shop is closed on ${formatDay(handover, { weekday: 'long', month: 'short', day: 'numeric' })}. Choose another ${handover === start ? 'pickup' : 'return'} date.` };
      }
    }
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (stateOf(day) !== 'available') {
        return { reason: 'other', message: `${formatDay(day, { month: 'short', day: 'numeric' })} is not available in that range. Choose other dates.` };
      }
    }
    return null;
  }

  function setPickup(date: string) {
    if (stateOf(date) !== 'available' || isClosed(date)) return;
    setMonth(date.slice(0, 7));
    // Keep a still-valid return date; otherwise suggest the earliest one the package allows,
    // moving past closed days because the shop cannot take the garment back on one.
    const keep = value && !rangeProblem(date, value.end) ? value.end : null;
    let suggested = keep ?? addDays(date, minimumNights);
    for (let step = 0; !keep && step < 7 && isClosed(suggested); step += 1) suggested = addDays(suggested, 1);
    if (!rangeProblem(date, suggested)) {
      setAnchor(null);
      onChange({ start: date, end: suggested });
      return;
    }
    setAnchor(date);
    onChange(null);
  }

  function setReturn(date: string) {
    if (!pickupDate) return;
    const problem = rangeProblem(pickupDate, date);
    if (problem) {
      // The pickup day stays chosen, so the renter only has to pick a different return day.
      setAnchor(pickupDate);
      onChange(null, problem);
      return;
    }
    setAnchor(null);
    onChange({ start: pickupDate, end: date });
  }

  const earliestReturnDate = pickupDate ? addDays(pickupDate, minimumNights) : null;

  function pickOnCalendar(date: string) {
    if (stateOf(date) !== 'available' || isClosed(date)) return;
    if (editing === 'from') {
      setPickup(date);
      setEditing('to');
      return;
    }
    if (!pickupDate || (earliestReturnDate && date < earliestReturnDate)) return;
    setReturn(date);
  }

  const returnDateHint = pickupDate && earliestReturnDate
    ? `Return date. The earliest is ${formatDay(earliestReturnDate, { month: 'short', day: 'numeric' })}.`
    : 'Choose a pickup date first.';

  function selectTarget(target: 'from' | 'to') {
    setEditing(target);
    const targetDate = target === 'from'
      ? pickupDate ?? today
      : value?.end ?? earliestReturnDate ?? today;
    setMonth(targetDate.slice(0, 7));
  }

  const inRange = (date: string) => (value ? date >= value.start && date <= value.end : anchor === date);
  const isEdge = (date: string) => (value ? date === value.start || date === value.end : anchor === date);

  return (
    <div>
      <p id="booking-calendar-active-target" className="mb-1 text-xs text-sf-muted" aria-live="polite">
        Choose a {editing === 'from' ? 'pickup' : 'return'} date on the calendar.
      </p>
      <MonthGrid
        month={month}
        today={today}
        onMonthChange={setMonth}
        stateOf={stateOf}
        isClosed={isClosed}
        loading={loadingMonths.has(month)}
        isSelected={inRange}
        isEdge={isEdge}
        onPick={pickOnCalendar}
        minimumDate={editing === 'to' ? earliestReturnDate ?? undefined : undefined}
      />

      <div role="group" aria-label="Rental dates" className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <button
            type="button"
            aria-label="Date from"
            aria-pressed={editing === 'from'}
            aria-describedby="booking-calendar-active-target booking-date-from-hint"
            onClick={() => selectTarget('from')}
            className={`sf-input flex w-full flex-col items-start text-left ${editing === 'from' ? 'border-sf-ink ring-1 ring-sf-ink' : ''}`}
          >
            <span className="text-[11px] uppercase tracking-[0.18em] text-sf-muted">Date from</span>
            <span className={`mt-0.5 tabular-nums ${pickupDate ? '' : 'text-sf-muted'}`}>
              {pickupDate ? formatDay(pickupDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Pickup date'}
            </span>
          </button>
          <p id="booking-date-from-hint" className="mt-1 text-xs text-sf-muted">Pickup date. It counts as Day 1.</p>
        </div>
        <div>
          <button
            type="button"
            aria-label="Date to"
            aria-pressed={editing === 'to'}
            aria-describedby="booking-calendar-active-target booking-date-to-hint"
            disabled={!pickupDate}
            onClick={() => selectTarget('to')}
            className={`sf-input flex w-full flex-col items-start text-left disabled:cursor-not-allowed disabled:opacity-50 ${editing === 'to' ? 'border-sf-ink ring-1 ring-sf-ink' : ''}`}
          >
            <span className="text-[11px] uppercase tracking-[0.18em] text-sf-muted">Date to</span>
            <span className={`mt-0.5 tabular-nums ${value?.end ? '' : 'text-sf-muted'}`}>
              {value?.end ? formatDay(value.end, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Return date'}
            </span>
          </button>
          <p id="booking-date-to-hint" className="mt-1 text-xs text-sf-muted">{returnDateHint}</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-sf-muted">
        <li className="flex items-center gap-2"><span className="h-3 w-3 border border-sf-ink/40" />Available</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 bg-[#F4E6C9]" />Reserved</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 bg-[#E9E4F6]" />Fitting</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 bg-sf-line/40" />Shop closed</li>
        <li className="flex items-center gap-2"><span className="text-sf-muted/60 line-through">12</span>Not available</li>
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#b3311f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
