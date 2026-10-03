import type { FieldRequirement, GuestReservationRequest, StorefrontCheckout } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

const DAY_MS = 86_400_000;

function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, time: `${parts['hour']}:${parts['minute']}` };
}

function assertRequirement(label: string, requirement: FieldRequirement, value: string | null): void {
  if (requirement === 'required' && value === null) throw new ValidationError(`${label} is required by this shop.`);
  if (requirement === 'hidden' && value !== null) throw new ValidationError(`${label} is not collected by this shop.`);
}

/**
 * The shop's checkout rules, enforced on the server whatever the browser sent: which optional
 * details are required or not collected, the handover time, minimum notice, and maximum length.
 * Rentals run from the handover time on the pickup date to the same time on the return date. The
 * pickup date is Day 1, so an Oct 5 pickup returned Oct 7 is a 3-day rental; the maximum counts
 * rental days the same way the price does.
 */
export function assertCheckoutRules(
  rules: StorefrontCheckout,
  request: Pick<GuestReservationRequest, 'customer' | 'event_date' | 'requested_interval'>,
  timeZone: string,
  now: Date = new Date(),
): void {
  assertRequirement('A mobile number', rules.requirements.phone, request.customer.phone);
  assertRequirement('A social media handle', rules.requirements.social_handle, request.customer.social_handle);
  assertRequirement('The event date', rules.requirements.event_date, request.event_date);

  const start = new Date(request.requested_interval.start);
  const end = new Date(request.requested_interval.end);
  const pickup = localParts(start, timeZone);
  const due = localParts(end, timeZone);
  if (pickup.time !== rules.handover_time || due.time !== rules.handover_time) {
    throw new ValidationError(`Pickup and return are at ${rules.handover_time}.`);
  }

  const spanMs = end.getTime() - start.getTime();
  if (spanMs < DAY_MS || spanMs % DAY_MS !== 0) {
    throw new ValidationError('Choose a rental of at least one full day.');
  }
  const rentalDays = (Date.parse(`${due.date}T00:00:00Z`) - Date.parse(`${pickup.date}T00:00:00Z`)) / DAY_MS + 1;
  if (rentalDays > rules.max_rental_days) {
    throw new ValidationError(`Rentals can be at most ${rules.max_rental_days} days.`);
  }

  const today = localParts(now, timeZone).date;
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) + rules.min_notice_days * DAY_MS).toISOString().slice(0, 10);
  if (pickup.date < earliest) {
    throw new ValidationError(
      rules.min_notice_days === 0 ? 'Pickup cannot be in the past.' : `Book at least ${rules.min_notice_days} day(s) ahead.`,
    );
  }
}
