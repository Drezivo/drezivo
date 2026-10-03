import { describe, expect, it } from 'vitest';

import { computeRentalTotal, countRentalDays } from '../reservations.quote.js';

const MANILA = 'Asia/Manila';
const DAY = 24 * 60;

/** A Manila wall-clock time (UTC+8, no DST) as an ISO instant. */
const manila = (date: string, time = '10:00') => new Date(`${date}T${time}:00+08:00`).toISOString();

const fixedThreeDay = (start: string, end: string) =>
  computeRentalTotal({
    requestedInterval: { start, end },
    timeZone: MANILA,
    pricingMode: 'fixed_duration',
    baseRentalMinor: '60000',
    includedDurationMinutes: 3 * DAY,
    extraDayPriceMinor: '10000',
  });

describe('rental days: the pickup date is Day 1', () => {
  it('matches the owner example: Oct 1 pickup, Oct 2 event, Oct 3 return is a 3-day rental', () => {
    expect(countRentalDays({ start: manila('2026-10-01'), end: manila('2026-10-03') }, MANILA)).toBe(3);
  });

  it('counts calendar dates, not elapsed hours or clock times', () => {
    // Late-afternoon pickup, early-morning return: still Day 1 to Day 3.
    expect(countRentalDays({ start: manila('2026-10-05', '16:00'), end: manila('2026-10-07', '09:00') }, MANILA)).toBe(3);
    // Same-date pickup and return is one rental day.
    expect(countRentalDays({ start: manila('2026-10-05', '09:00'), end: manila('2026-10-05', '18:00') }, MANILA)).toBe(1);
    // 23:30 to 00:30 crosses a local date, so it is two days.
    expect(countRentalDays({ start: manila('2026-10-05', '23:30'), end: manila('2026-10-06', '00:30') }, MANILA)).toBe(2);
  });

  it('crosses month, year, and leap-day boundaries', () => {
    expect(countRentalDays({ start: manila('2026-10-31'), end: manila('2026-11-02') }, MANILA)).toBe(3);
    expect(countRentalDays({ start: manila('2026-12-31'), end: manila('2027-01-01') }, MANILA)).toBe(2);
    expect(countRentalDays({ start: manila('2028-02-28'), end: manila('2028-03-01') }, MANILA)).toBe(3);
  });

  it('uses the branch timezone across a DST change', () => {
    // New York springs forward on 2027-03-14: Mar 13 10:00 EST to Mar 15 10:00 EDT.
    expect(
      countRentalDays({ start: '2027-03-13T15:00:00.000Z', end: '2027-03-15T14:00:00.000Z' }, 'America/New_York'),
    ).toBe(3);
  });
});

describe('fixed-duration package pricing', () => {
  it('rejects a 3-day package returned on Day 2', () => {
    expect(() => fixedThreeDay(manila('2026-10-05'), manila('2026-10-06', '20:00'))).toThrow(
      'This clothing variant is a 3-day rental. The pickup date counts as Day 1, so the return date must be at least 2 days after the pickup date.',
    );
  });

  it('charges the base price for an Oct 5 pickup returned Oct 7', () => {
    expect(fixedThreeDay(manila('2026-10-05', '16:00'), manila('2026-10-07', '10:00'))).toEqual({
      totalMinor: 60000n,
      extraDayCount: 0,
      includedRentalDays: 3,
      rentalDayCount: 3,
    });
  });

  it('adds one extra day per later return date', () => {
    expect(fixedThreeDay(manila('2026-10-05'), manila('2026-10-08'))).toMatchObject({ totalMinor: 70000n, extraDayCount: 1 });
    expect(fixedThreeDay(manila('2026-10-05'), manila('2026-10-09'))).toMatchObject({ totalMinor: 80000n, extraDayCount: 2 });
  });

  it('refuses a return before the pickup date', () => {
    expect(() => fixedThreeDay(manila('2026-10-05'), manila('2026-10-04'))).toThrow(
      'The return date cannot be before the pickup date.',
    );
  });

  it('refuses a tariff that is not stored in whole days instead of guessing', () => {
    expect(() =>
      computeRentalTotal({
        requestedInterval: { start: manila('2026-10-05'), end: manila('2026-10-08') },
        timeZone: MANILA,
        pricingMode: 'fixed_duration',
        baseRentalMinor: '60000',
        includedDurationMinutes: 3 * DAY - 1,
        extraDayPriceMinor: '10000',
      }),
    ).toThrow('not in whole days');
  });
});

describe('daily pricing', () => {
  const daily = (start: string, end: string) =>
    computeRentalTotal({
      requestedInterval: { start, end },
      timeZone: MANILA,
      pricingMode: 'daily',
      baseRentalMinor: '30000',
      includedDurationMinutes: DAY,
      extraDayPriceMinor: '30000',
    });

  it('charges the daily rate for every rental date, pickup date included', () => {
    expect(daily(manila('2026-10-05', '09:00'), manila('2026-10-05', '18:00'))).toMatchObject({ totalMinor: 30000n, rentalDayCount: 1 });
    expect(daily(manila('2026-10-05'), manila('2026-10-07'))).toMatchObject({ totalMinor: 90000n, rentalDayCount: 3 });
  });
});
