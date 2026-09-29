'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PublicDayState } from '@drezivo/contracts';

import { getAvailability } from '@/lib/storefront-api';
import { addDays, daysBetween, formatDay } from '@/lib/storefront-format';

export interface DateRange {
  start: string;
  end: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
 * Pick pickup then return. Only days the API reports as available can be part of a range; the
 * server re-checks everything when the hold is placed, so this is guidance, not a guarantee.
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
  onChange: (range: DateRange | null, message?: string) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [states, setStates] = useState<Record<string, PublicDayState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const days = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    let cancelled = false;
    const from = days[0] ?? today;
    const to = days[days.length - 1] ?? today;
    setLoading(true);
    setError(null);
    getAvailability(slug, variantId, from, to)
      .then((result) => {
        if (cancelled) return;
        setStates((current) => ({ ...current, ...Object.fromEntries(result.days.map((day) => [day.date, day.state])) }));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load availability. Try again in a moment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, variantId, days, today]);

  useEffect(() => {
    setStates({});
    setAnchor(null);
  }, [variantId]);

  const stateOf = (date: string): PublicDayState => states[date] ?? 'unavailable';

  function pick(date: string) {
    if (stateOf(date) !== 'available') return;
    if (!anchor || date <= anchor) {
      setAnchor(date);
      onChange(null);
      return;
    }
    const length = daysBetween(anchor, date);
    if (length < minDays) {
      // The pickup day stays chosen, so the renter only has to pick a later return day.
      onChange(null, `This piece rents for at least ${minDays} days. Choose a later return date.`);
      return;
    }
    if (length > maxDays) {
      onChange(null, `The longest rental is ${maxDays} day${maxDays === 1 ? '' : 's'}.`);
      return;
    }
    for (let day = anchor; day <= date; day = addDays(day, 1)) {
      if (stateOf(day) !== 'available') {
        onChange(null, `${formatDay(day, { month: 'short', day: 'numeric' })} is not available in that range. Choose other dates.`);
        return;
      }
    }
    setAnchor(null);
    onChange({ start: anchor, end: date });
  }

  const inRange = (date: string) => (value ? date >= value.start && date <= value.end : anchor === date);
  const canGoBack = month > today.slice(0, 7);

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-10 w-10 items-center justify-center disabled:opacity-30" disabled={!canGoBack} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <p className="font-sf-display text-xl" aria-live="polite">
          {monthLabel(month)}
        </p>
        <button type="button" className="flex h-10 w-10 items-center justify-center" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      <div role="grid" aria-label={`Availability for ${monthLabel(month)}`} aria-busy={loading} className={`mt-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
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
              const state = stateOf(date);
              const selected = inRange(date);
              const edge = value ? date === value.start || date === value.end : anchor === date;
              if (outside) return <span role="gridcell" key={date} aria-hidden="true" />;
              return (
                <span role="gridcell" key={date} className="flex justify-center">
                  <button
                    type="button"
                    disabled={state !== 'available'}
                    aria-pressed={selected}
                    aria-label={`${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${state === 'available' ? 'available' : state}`}
                    onClick={() => pick(date)}
                    className={[
                      'flex h-10 w-full max-w-11 items-center justify-center text-sm tabular-nums transition-colors',
                      selected && edge ? 'bg-sf-accent text-sf-accent-ink' : selected ? 'bg-sf-line' : STATE_STYLE[state],
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

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-sf-muted">
        <li className="flex items-center gap-2"><span className="h-3 w-3 border border-sf-ink/40" />Available</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 bg-[#F4E6C9]" />Reserved</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 bg-[#E9E4F6]" />Fitting</li>
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
