import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { addDays } from '@/lib/storefront-format';

const busy = new Set(['2026-10-14']);
// Sundays: the shop is closed, so they cannot be a pickup or return day.
const closed = new Set(['2026-10-04', '2026-10-11', '2026-10-18']);

vi.mock('@/lib/storefront-api', () => ({
  getAvailability: vi.fn(async (_slug: string, _variant: string, from: string, to: string) => {
    const days = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      days.push({ date, state: busy.has(date) ? 'reserved' : 'available', ...(closed.has(date) ? { closed: true } : {}) });
    }
    return { days };
  }),
}));

import { AvailabilityCalendar, type DateRange } from '@/components/store/booking/availability-calendar';

function renderCalendar(minDays: number) {
  const onChange = vi.fn();
  function Harness() {
    const [range, setRange] = useState<DateRange | null>(null);
    return (
      <AvailabilityCalendar
        slug="test-shop"
        variantId="00000000-0000-4000-8000-000000000101"
        today="2026-10-01"
        minDays={minDays}
        maxDays={14}
        value={range}
        onChange={(next, notice) => {
          setRange(next);
          onChange(next, notice);
        }}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

/** The pop-over grid renders after the main grid, so its day button is the last match. */
async function pickInPopover(day: RegExp) {
  await waitFor(() => expect((screen.getAllByRole('button', { name: day }).at(-1) as HTMLButtonElement | undefined)?.disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: day }).at(-1)!);
}

describe('storefront Date from / Date to fields', () => {
  it('fills the earliest return date, counting the pickup date as Day 1', async () => {
    const onChange = renderCalendar(3);

    fireEvent.click(screen.getByRole('button', { name: 'Date from' }));
    await pickInPopover(/October 5/);

    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-05', end: '2026-10-07' }, undefined);
    expect(screen.getByRole('button', { name: 'Date to' }).textContent).toContain('Oct 7, 2026');
  });

  it('keeps the fields and the calendar in step', async () => {
    renderCalendar(3);

    await waitFor(() => expect((screen.getAllByRole('button', { name: /October 20/ })[0] as HTMLButtonElement | undefined)?.disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: /October 20/ })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: /October 23/ })[0]!);

    expect(screen.getByRole('button', { name: 'Date from' }).textContent).toContain('Oct 20, 2026');
    expect(screen.getByRole('button', { name: 'Date to' }).textContent).toContain('Oct 23, 2026');
  });

  it('refuses a return date that would cross a reserved day', async () => {
    const onChange = renderCalendar(2);

    fireEvent.click(screen.getByRole('button', { name: 'Date from' }));
    await pickInPopover(/October 12/);
    fireEvent.click(screen.getByRole('button', { name: 'Date to' }));
    await pickInPopover(/October 16/);

    expect(onChange).toHaveBeenLastCalledWith(null, 'Oct 14 is not available in that range. Choose other dates.');
  });

  it('does not offer a closed day as pickup or return, but lets a rental run across one', async () => {
    const onChange = renderCalendar(2);

    // Sunday Oct 11 is closed: it cannot be chosen at all.
    await waitFor(() => expect((screen.getAllByRole('button', { name: /October 10/ })[0] as HTMLButtonElement | undefined)?.disabled).toBe(false));
    expect((screen.getAllByRole('button', { name: /October 11/ })[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: /October 11, shop closed/ }).length).toBeGreaterThan(0);

    // Saturday pickup, Monday return: the closed Sunday in between is fine.
    fireEvent.click(screen.getAllByRole('button', { name: /October 10/ })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: /October 12/ })[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-10', end: '2026-10-12' }, undefined);
  });

  it('suggests the next open day when the earliest return date is closed', async () => {
    const onChange = renderCalendar(2);

    fireEvent.click(screen.getByRole('button', { name: 'Date from' }));
    await pickInPopover(/October 10/);

    // Oct 11 (Day 2) is a Sunday, so the suggested return moves to Monday Oct 12.
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-10', end: '2026-10-12' }, undefined);
  });

  it('greys out return dates shorter than the package', async () => {
    renderCalendar(3);

    fireEvent.click(screen.getByRole('button', { name: 'Date from' }));
    await pickInPopover(/October 5/);
    fireEvent.click(screen.getByRole('button', { name: 'Date to' }));

    // Oct 5 is Day 1, so Oct 6 (Day 2) cannot be the return date of a 3-day package; Oct 7 can.
    await waitFor(() => expect((screen.getAllByRole('button', { name: /October 7/ }).at(-1) as HTMLButtonElement | undefined)?.disabled).toBe(false));
    expect((screen.getAllByRole('button', { name: /October 6/ }).at(-1) as HTMLButtonElement | undefined)?.disabled).toBe(true);
  });

  it('explains the Day 1 rule when the calendar return date is too early', async () => {
    const onChange = renderCalendar(3);

    await waitFor(() => expect((screen.getAllByRole('button', { name: /October 5/ })[0] as HTMLButtonElement | undefined)?.disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: /October 5/ })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: /October 6/ })[0]!);

    expect(onChange).toHaveBeenLastCalledWith(
      null,
      'This piece rents for at least 3 days, counting the pickup date as Day 1. Choose a later return date.',
    );
  });
});
