import type { FieldRequirement, GuestReservationRequest, StorefrontCheckout } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { closedReason, type ShopClosures } from '../storefront/shop-closures.js';

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

/** Branch-local pickup and return dates of a guest request, the days the handover happens. */
export function handoverDates(
  request: Pick<GuestReservationRequest, 'requested_interval'>,
  timeZone: string,
): { pickup: string; return: string } {
  return {
    pickup: localParts(new Date(request.requested_interval.start), timeZone).date,
    return: localParts(new Date(request.requested_interval.end), timeZone).date,
  };
}

function closedMessage(reason: NonNullable<ReturnType<typeof closedReason>>, date: string, which: 'pickup' | 'return'): string {
  const subject =
    reason.kind === 'weekday'
      ? `on ${reason.weekday.charAt(0).toUpperCase()}${reason.weekday.slice(1)}s`
      : `on ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))}`;
  return `The shop is closed ${subject}. Choose another ${which} date.`;
}

/**
 * The shop must be open for the handover: pickup and return cannot land on a closed weekday or a
 * special closure date. Days in the middle of a rental may be closed; the garment is simply kept.
 * Fails closed: it is called with the closures read in the same transaction as the hold.
 */
export function assertShopOpenForHandover(
  closures: ShopClosures,
  request: Pick<GuestReservationRequest, 'requested_interval'>,
  timeZone: string,
): void {
  const dates = handoverDates(request, timeZone);
  const pickupClosed = closedReason(closures, dates.pickup);
  if (pickupClosed) throw new ValidationError(closedMessage(pickupClosed, dates.pickup, 'pickup'));
  const returnClosed = closedReason(closures, dates.return);
  if (returnClosed) throw new ValidationError(closedMessage(returnClosed, dates.return, 'return'));
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
    throw new ValidationError(`The longest rental allowed is ${rules.max_rental_days} day${rules.max_rental_days === 1 ? '' : 's'}.`);
  }

  const today = localParts(now, timeZone).date;
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) + rules.min_notice_days * DAY_MS).toISOString().slice(0, 10);
  if (pickup.date < earliest) {
    throw new ValidationError(
      rules.min_notice_days === 0 ? 'Pickup cannot be in the past.' : `Book at least ${rules.min_notice_days} day(s) ahead.`,
    );
  }
}
