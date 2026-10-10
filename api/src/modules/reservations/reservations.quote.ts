import type { PoolClient } from 'pg';

import {
  branchId,
  productVariantId,
  tenantId,
  type DeliveryTerms,
  type FulfillmentMethod,
  type InstantInterval,
  type PaymentMethodId,
  type PhysicalAssetId,
  type ProductId,
  type ProductVariantId,
  type StaffReservationCreateRequest,
  type StorefrontId,
  type VariantMeasurementMap,
} from '@drezivo/contracts';

import { resolveReservationCatalogueQuoteSelection } from '../catalogue/catalogue-allocation.service.js';
import { NotFoundError, StateConflictError, ValidationError } from '../../shared/errors.js';
import {
  readReservationQuoteFoundation,
  readReservationQuotePaymentMethod,
} from './reservations.repository.js';

const POSTGRES_INT_MAX = 2_147_483_647n;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 86_400_000;

/**
 * How rental days are counted for new quotes. Recorded on every new price snapshot so an accepted
 * reservation always says which rule produced its total; snapshots written before this rule have
 * no basis and were priced on elapsed 24-hour blocks.
 */
export const RENTAL_DAY_BASIS = 'calendar_day_inclusive';

export interface ReservationQuote {
  branch_id: string;
  storefront_id: StorefrontId;
  policy_snapshot_id: string;
  payment_method_id: PaymentMethodId;
  product_id: ProductId;
  variant_id: ProductVariantId;
  pickup_at: string;
  due_at: string;
  timezone_snapshot: string;
  blocked_interval: InstantInterval;
  capacity: {
    /** Best-effort candidates only. RSV-021 must lock/revalidate before claiming one. */
    candidate_asset_ids: PhysicalAssetId[];
    guaranteed: false;
  };
  line_snapshot: {
    name: string;
    sku: string;
    size_label: string | null;
    color_label: string | null;
    measurement_mode: 'default_guide' | 'custom' | 'none';
    measurement_guide_id: string | null;
    measurement_unit: 'cm' | 'in';
    measurements: VariantMeasurementMap;
    fit_range: string | null;
  };
  price_snapshot: {
    rental_total_minor: string;
    security_required_minor: string;
    delivery_total_minor: string;
    due_now_minor: string;
    currency: 'PHP';
    pricing_mode: 'fixed_duration' | 'daily';
    included_duration_minutes: number;
    extra_day_price_minor: string;
    extra_day_count: number;
    rental_day_basis: typeof RENTAL_DAY_BASIS;
    included_rental_days: number;
    rental_day_count: number;
  };
  delivery_snapshot: {
    fulfillment_method: FulfillmentMethod;
    fee_minor: string;
    /** Set on deliveries only: whether the fee was charged or the shop arranges it with the renter. */
    terms?: DeliveryTerms;
  };
  policy_snapshot: {
    id: string;
    version: number;
    effective_at: string;
    rental_rules: Record<string, unknown>;
    deposit_rules: Record<string, unknown>;
    cancellation_rules: Record<string, unknown>;
    delivery_rules: Record<string, unknown>;
    privacy_notice: string;
  };
  payment_method_snapshot: {
    id: PaymentMethodId;
    name: string;
    rail: 'cash' | 'manual_qr' | 'manual_transfer';
    destination_snapshot: Record<string, unknown>;
    version: number;
  };
}

export type ReservationQuoteRequest = Pick<
  StaffReservationCreateRequest,
  'variant_id' | 'requested_interval' | 'event_date' | 'fulfillment_method' | 'payment_method_id'
>;

/**
 * Computes the authoritative quote inputs for a future booking transaction without claiming
 * capacity. The returned candidate set is intentionally advisory: only RSV-021 may turn one of
 * those ids into a promise by locking/revalidating it and inserting the exclusion-protected block.
 */
export async function assertRequestedPickupNotInPast(
  client: PoolClient,
  pickupAt: string,
): Promise<void> {
  const nowResult = await client.query<{ current_minute: Date }>(
    `SELECT date_trunc('minute', statement_timestamp()) AS current_minute`,
  );
  const currentMinute = nowResult.rows[0]?.current_minute;
  if (!currentMinute) throw new StateConflictError('Could not resolve the current reservation time.');
  if (new Date(pickupAt).getTime() < currentMinute.getTime()) {
    throw new ValidationError('Pickup time cannot be in the past. Choose the current minute or a future time.');
  }
}

export async function resolveReservationQuote(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    request: ReservationQuoteRequest;
  },
): Promise<ReservationQuote> {
  await assertRequestedPickupNotInPast(client, input.request.requested_interval.start);

  const foundation = await readReservationQuoteFoundation(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
  });
  if (!foundation) {
    throw new StateConflictError(
      'The default branch needs an effective storefront policy before reservations can be quoted.',
    );
  }
  assertSupportedTimezone(foundation.branch_timezone);
  assertEventDateWithinRentalPeriod({
    eventDate: input.request.event_date,
    requestedInterval: input.request.requested_interval,
    timeZone: foundation.branch_timezone,
  });
  if (foundation.tenant_currency !== 'PHP') {
    throw new StateConflictError('V1 reservation quotes require the tenant currency to be PHP.');
  }

  const paymentMethod = await readReservationQuotePaymentMethod(client, {
    tenantId: input.tenantId,
    paymentMethodId: input.request.payment_method_id,
  });
  if (!paymentMethod) {
    throw new NotFoundError('Payment method could not be found.');
  }

  const catalogue = await resolveReservationCatalogueQuoteSelection(client, {
    tenantId: tenantId.parse(input.tenantId),
    branchId: branchId.parse(input.branchId),
    variantId: productVariantId.parse(input.request.variant_id),
    requestedInterval: input.request.requested_interval,
  });
  if (!catalogue) {
    throw new NotFoundError('Clothing variant could not be found.');
  }
  if (catalogue.variant.currency !== 'PHP') {
    throw new StateConflictError('V1 reservation quotes require clothing pricing in PHP.');
  }

  const rental = computeRentalTotal({
    requestedInterval: input.request.requested_interval,
    timeZone: foundation.branch_timezone,
    pricingMode: catalogue.variant.pricing_mode,
    baseRentalMinor: catalogue.variant.rental_price_minor,
    includedDurationMinutes: catalogue.variant.included_duration_minutes,
    extraDayPriceMinor: catalogue.variant.extra_day_price_minor,
  });
  const securityDeposit = parseMinorUnits(
    catalogue.variant.security_deposit_minor,
    'Security deposit',
  );
  const delivery = resolveDelivery(foundation.delivery_rules, input.request.fulfillment_method);
  const deliveryFee = delivery.feeMinor;
  const dueNow = assertSupportedAmount(
    rental.totalMinor + securityDeposit + deliveryFee,
    'Reservation amount due now',
  );

  return {
    branch_id: input.branchId,
    storefront_id: foundation.storefront_id as StorefrontId,
    policy_snapshot_id: foundation.policy_snapshot_id,
    payment_method_id: paymentMethod.payment_method_id as PaymentMethodId,
    product_id: catalogue.product_id,
    variant_id: catalogue.variant_id,
    pickup_at: input.request.requested_interval.start,
    due_at: input.request.requested_interval.end,
    timezone_snapshot: foundation.branch_timezone,
    blocked_interval: catalogue.blocked_interval,
    capacity: {
      candidate_asset_ids: catalogue.candidate_asset_ids,
      guaranteed: false,
    },
    line_snapshot: {
      name: catalogue.product_name,
      sku: catalogue.variant.sku,
      size_label: catalogue.variant.size_label,
      color_label: catalogue.variant.color_label,
      measurement_mode: catalogue.variant.measurement_mode,
      measurement_guide_id: catalogue.variant.measurement_guide_id,
      measurement_unit: catalogue.variant.measurement_unit,
      measurements: catalogue.variant.measurements,
      fit_range: catalogue.variant.fit_range ?? null,
    },
    price_snapshot: {
      rental_total_minor: rental.totalMinor.toString(),
      security_required_minor: securityDeposit.toString(),
      delivery_total_minor: deliveryFee.toString(),
      due_now_minor: dueNow.toString(),
      currency: 'PHP',
      pricing_mode: catalogue.variant.pricing_mode,
      included_duration_minutes: catalogue.variant.included_duration_minutes,
      extra_day_price_minor: catalogue.variant.extra_day_price_minor,
      extra_day_count: rental.extraDayCount,
      rental_day_basis: RENTAL_DAY_BASIS,
      included_rental_days: rental.includedRentalDays,
      rental_day_count: rental.rentalDayCount,
    },
    delivery_snapshot: {
      fulfillment_method: input.request.fulfillment_method,
      fee_minor: deliveryFee.toString(),
      ...(delivery.terms ? { terms: delivery.terms } : {}),
    },
    policy_snapshot: {
      id: foundation.policy_snapshot_id,
      version: foundation.policy_version,
      effective_at: foundation.policy_effective_at.toISOString(),
      rental_rules: foundation.rental_rules,
      deposit_rules: foundation.deposit_rules,
      cancellation_rules: foundation.cancellation_rules,
      delivery_rules: foundation.delivery_rules,
      privacy_notice: foundation.privacy_notice,
    },
    payment_method_snapshot: {
      id: paymentMethod.payment_method_id as PaymentMethodId,
      name: paymentMethod.name,
      rail: paymentMethod.rail,
      destination_snapshot: paymentMethod.destination_snapshot,
      version: paymentMethod.version,
    },
  };
}

/**
 * Rental days are branch-local calendar dates counted inclusively: the pickup date is Day 1 and the
 * return date is the last rental day (owner rule, 2026-10-03). A 3-day package picked up Oct 5 is
 * returned Oct 7 at the base price; an Oct 8 return adds one extra day. Pickup and return clock times
 * never change the count, so a late-afternoon pickup is still a full Day 1. Asset blocking stays
 * timestamp-precise and is handled separately from this pricing count.
 *
 * `daily` pricing is a 1-day package whose extra-day price is the daily rate, so it follows the
 * same count: Oct 5 to Oct 7 is three days at the daily rate.
 */
export function computeRentalTotal(input: {
  requestedInterval: InstantInterval;
  timeZone: string;
  pricingMode: 'fixed_duration' | 'daily';
  baseRentalMinor: string;
  includedDurationMinutes: number;
  extraDayPriceMinor: string;
}): { totalMinor: bigint; extraDayCount: number; includedRentalDays: number; rentalDayCount: number } {
  const includedRentalDays = includedRentalDaysOf(input.includedDurationMinutes);
  const rentalDayCount = countRentalDays(input.requestedInterval, input.timeZone);
  if (rentalDayCount < 1) {
    throw new ValidationError('The return date cannot be before the pickup date.');
  }
  if (input.pricingMode === 'fixed_duration' && rentalDayCount < includedRentalDays) {
    throw new StateConflictError(minimumRentalDaysMessage(includedRentalDays));
  }
  const extraDays = BigInt(Math.max(0, rentalDayCount - includedRentalDays));

  const baseRental = parseMinorUnits(input.baseRentalMinor, 'Rental price');
  const extraDayPrice = parseMinorUnits(input.extraDayPriceMinor, 'Extra-day price');
  const totalMinor = assertSupportedAmount(
    baseRental + extraDays * extraDayPrice,
    'Rental total',
  );
  return {
    totalMinor,
    extraDayCount: Number(extraDays),
    includedRentalDays,
    rentalDayCount,
  };
}

/** Inclusive branch-local calendar days from the pickup date to the return date. */
export function countRentalDays(interval: InstantInterval, timeZone: string): number {
  const pickupDay = isoDateDayNumber(localIsoDate(interval.start, timeZone));
  const returnDay = isoDateDayNumber(localIsoDate(interval.end, timeZone));
  return returnDay - pickupDay + 1;
}

/**
 * Tariffs store their package length as whole days times 1,440 minutes (the owner enters days).
 * A value that is not whole days cannot be counted in calendar days, so it is refused rather than
 * rounded into a price the owner never set.
 */
function includedRentalDaysOf(includedDurationMinutes: number): number {
  if (includedDurationMinutes <= 0 || includedDurationMinutes % MINUTES_PER_DAY !== 0) {
    throw new StateConflictError(
      'This clothing variant has a rental period that is not in whole days. Update its pricing before booking.',
    );
  }
  return includedDurationMinutes / MINUTES_PER_DAY;
}

function minimumRentalDaysMessage(days: number): string {
  if (days === 1) return 'This clothing variant is a 1-day rental.';
  const lastDay = days - 1;
  return `This clothing variant is a ${days}-day rental. The pickup date counts as Day 1, so the return date must be at least ${lastDay} ${lastDay === 1 ? 'day' : 'days'} after the pickup date.`;
}

/** Days since the epoch for a YYYY-MM-DD date. Pure date arithmetic, so DST cannot skew it. */
function isoDateDayNumber(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY;
}

function assertEventDateWithinRentalPeriod(input: {
  eventDate: string | undefined;
  requestedInterval: InstantInterval;
  timeZone: string;
}): void {
  if (!input.eventDate) return;
  const pickupDate = localIsoDate(input.requestedInterval.start, input.timeZone);
  const dueDate = localIsoDate(input.requestedInterval.end, input.timeZone);
  if (input.eventDate < pickupDate || input.eventDate > dueDate) {
    throw new ValidationError('Event date must fall within the pickup and return dates.');
  }
}

function localIsoDate(instantValue: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(instantValue))
      .map((part) => [part.type, part.value]),
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/**
 * Pickup is free. A shop that offers delivery charges its configured fee (`set_fee`). A shop that
 * has not set up delivery still lets the renter ask for it: nothing is added to the total and the
 * shop is told to contact the renter to arrange it (`to_arrange`).
 */
function resolveDelivery(
  rules: Record<string, unknown>,
  fulfillmentMethod: FulfillmentMethod,
): { feeMinor: bigint; terms: DeliveryTerms | null } {
  if (fulfillmentMethod === 'pickup') return { feeMinor: 0n, terms: null };
  if (rules.enabled !== true) return { feeMinor: 0n, terms: 'to_arrange' };
  const configuredFee = rules.fee_minor;
  if (configuredFee === undefined || configuredFee === null || configuredFee === '') return { feeMinor: 0n, terms: 'set_fee' };
  return { feeMinor: parseMinorUnits(configuredFee, 'Delivery fee'), terms: 'set_fee' };
}

function parseMinorUnits(value: unknown, label: string): bigint {
  let amount: bigint;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    amount = BigInt(value);
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    amount = BigInt(value);
  } else {
    throw new StateConflictError(`${label} is not configured as non-negative integer minor units.`);
  }
  return assertSupportedAmount(amount, label);
}

function assertSupportedAmount(amount: bigint, label: string): bigint {
  if (amount < 0n || amount > POSTGRES_INT_MAX) {
    throw new StateConflictError(`${label} is outside the supported V1 amount range.`);
  }
  return amount;
}

function assertSupportedTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new StateConflictError('The default branch timezone is invalid.');
  }
}
