'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PublicDayState } from '@drezivo/contracts';

import { getAvailability } from '@/lib/storefront-api';
import { addDays, formatDay, rentalDays } from '@/lib/storefront-format';

export interface DateRange {
  start: string;
  end: string;
}

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
 * and both date fields, so a month is fetched once however many pickers show it.
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
  compact = false,
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
  compact?: boolean;
}) {
  const days = useMemo(() => monthGrid(month), [month]);
  const canGoBack = month > today.slice(0, 7);
  const cell = compact ? 'h-9 max-w-10' : 'h-10 max-w-11';

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-10 w-10 items-center justify-center disabled:opacity-30" disabled={!canGoBack} onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <p className={`font-sf-display ${compact ? 'text-lg' : 'text-xl'}`} aria-live="polite">
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
              const selected = isSelected(date);
              // Only an otherwise bookable day is shown as "closed"; a reserved closed day stays reserved.
              const closed = state === 'available' && isClosed(date);
              if (outside) return <span role="gridcell" key={date} aria-hidden="true" />;
              return (
                <span role="gridcell" key={date} className="flex justify-center">
                  <button
                    type="button"
                    disabled={state !== 'available' || closed}
                    aria-pressed={selected}
                    aria-label={`${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${closed ? 'shop closed' : state === 'available' ? 'available' : state}`}
                    onClick={() => onPick(date)}
                    className={[
                      `flex w-full ${cell} items-center justify-center text-sm tabular-nums transition-colors`,
                      selected && isEdge(date) ? 'bg-sf-accent text-sf-accent-ink' : selected ? 'bg-sf-line' : closed ? CLOSED_STYLE : STATE_STYLE[state],
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

/** A labelled date button whose pop-over is the same availability grid as the main calendar. */
function DateField({
  label,
  hint,
  value,
  placeholder,
  disabled = false,
  open,
  onOpenChange,
  initialMonth,
  today,
  availability,
  onPick,
}: {
  label: string;
  hint: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMonth: string;
  today: string;
  availability: ReturnType<typeof useMonthAvailability>;
  onPick: (date: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { ensureMonth } = availability;

  // On a phone the fields sit low in the drawer, so bring the opened month fully into view.
  useEffect(() => {
    if (open) popoverRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  useEffect(() => {
    if (open) setMonth(initialMonth);
  }, [open, initialMonth]);
  useEffect(() => {
    if (open) ensureMonth(month);
  }, [open, month, ensureMonth]);

  return (
    <div>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={`sf-input flex w-full flex-col items-start text-left disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'border-sf-ink' : ''}`}
      >
        <span className="text-[11px] uppercase tracking-[0.18em] text-sf-muted">{label}</span>
        <span className={`mt-0.5 tabular-nums ${value ? '' : 'text-sf-muted'}`}>
          {value ? formatDay(value, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : placeholder}
        </span>
      </button>
      {open ? (
        // Spans both fields (the wrapper is the positioning context), so it never runs off a phone screen.
        <div ref={popoverRef} role="dialog" aria-label={`${label}: choose a date`} className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 border border-sf-line bg-sf-surface p-3 shadow-xl">
          <p className="mb-1 text-xs text-sf-muted">{hint}</p>
          <MonthGrid
            compact
            month={month}
            today={today}
            onMonthChange={setMonth}
            stateOf={availability.stateOf}
            isClosed={availability.isClosed}
            loading={availability.loadingMonths.has(month)}
            isSelected={(date) => date === value}
            isEdge={(date) => date === value}
            onPick={onPick}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pick pickup then return on the calendar, or set either date in the fields below it; both stay in
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
  onChange: (range: DateRange | null, message?: string) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [openField, setOpenField] = useState<'from' | 'to' | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const availability = useMonthAvailability(slug, variantId);
  const { stateOf, isClosed, ensureMonth, loadingMonths, error } = availability;

  useEffect(() => ensureMonth(month), [month, ensureMonth]);
  useEffect(() => setAnchor(null), [variantId]);

  useEffect(() => {
    if (!openField) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!fieldsRef.current?.contains(event.target as Node)) setOpenField(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenField(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openField]);

  const pickupDate = value?.start ?? anchor;
  // The pickup date is Day 1 and a storefront rental spans at least one night (pickup and return
  // share one handover time), so the earliest return is pickup + max(minDays - 1, 1) days.
  const minimumNights = Math.max(minDays - 1, 1);

  /** Why a range cannot be booked, or null when it can. Mirrors the server's checkout rules. */
  function rangeProblem(start: string, end: string): string | null {
    const length = rentalDays(start, end);
    if (end <= start || length < minDays) {
      return `This piece rents for at least ${Math.max(minDays, 2)} days, counting the pickup date as Day 1. Choose a later return date.`;
    }
    if (length > maxDays) return `The longest rental is ${maxDays} day${maxDays === 1 ? '' : 's'}.`;
    for (const handover of [start, end]) {
      if (isClosed(handover)) {
        return `The shop is closed on ${formatDay(handover, { weekday: 'long', month: 'short', day: 'numeric' })}. Choose another ${handover === start ? 'pickup' : 'return'} date.`;
      }
    }
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (stateOf(day) !== 'available') {
        return `${formatDay(day, { month: 'short', day: 'numeric' })} is not available in that range. Choose other dates.`;
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

  function pickOnCalendar(date: string) {
    if (stateOf(date) !== 'available' || isClosed(date)) return;
    if (!anchor || date <= anchor) {
      setAnchor(date);
      onChange(null);
      return;
    }
    setReturn(date);
  }

  const inRange = (date: string) => (value ? date >= value.start && date <= value.end : anchor === date);
  const isEdge = (date: string) => (value ? date === value.start || date === value.end : anchor === date);

  return (
    <div>
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
      />

      <div ref={fieldsRef} className="relative mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <DateField
          label="Date from"
          hint="Pickup date. It counts as Day 1."
          value={pickupDate}
          placeholder="Pickup date"
          open={openField === 'from'}
          onOpenChange={(open) => setOpenField(open ? 'from' : null)}
          initialMonth={(pickupDate ?? today).slice(0, 7)}
          today={today}
          availability={availability}
          onPick={(date) => {
            setPickup(date);
            setOpenField(null);
          }}
        />
        <DateField
          label="Date to"
          hint={
            pickupDate
              ? `Return date. The earliest is ${formatDay(addDays(pickupDate, minimumNights), { month: 'short', day: 'numeric' })}.`
              : 'Choose a pickup date first.'
          }
          value={value?.end ?? null}
          placeholder="Return date"
          disabled={!pickupDate}
          open={openField === 'to'}
          onOpenChange={(open) => setOpenField(open ? 'to' : null)}
          initialMonth={(value?.end ?? (pickupDate ? addDays(pickupDate, minimumNights) : today)).slice(0, 7)}
          // Days before the earliest valid return are greyed out rather than refused after a tap.
          today={pickupDate ? addDays(pickupDate, minimumNights) : today}
          availability={availability}
          onPick={(date) => {
            setReturn(date);
            setOpenField(null);
          }}
        />
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
