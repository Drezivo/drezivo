import type { PoolClient } from 'pg';

import {
  branchId,
  productVariantId,
  tenantId,
  type FulfillmentMethod,
  type InstantInterval,
  type PaymentMethodId,
  type PhysicalAssetId,
  type ProductId,
  type ProductVariantId,
  type StaffReservationCreateRequest,
  type StorefrontId,
} from '@drezivo/contracts';

import { resolveReservationCatalogueQuoteSelection } from '../catalogue/catalogue-allocation.service.js';
import { NotFoundError, StateConflictError, ValidationError } from '../../shared/errors.js';
import {
  readReservationQuoteFoundation,
  readReservationQuotePaymentMethod,
} from './reservations.repository.js';

const POSTGRES_INT_MAX = 2_147_483_647n;
const DAY_MS = 24n * 60n * 60n * 1_000n;
const MINUTE_MS = 60n * 1_000n;

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
    size_label: string;
    color_label: string | null;
    measurement_mode: 'default_guide' | 'custom' | 'none';
    measurement_guide_id: string | null;
    measurement_unit: 'cm' | 'in';
    measurements: Record<string, number>;
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
  };
  delivery_snapshot: {
    fulfillment_method: FulfillmentMethod;
    fee_minor: string;
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

/**
 * Computes the authoritative quote inputs for a future booking transaction without claiming
 * capacity. The returned candidate set is intentionally advisory: only RSV-021 may turn one of
 * those ids into a promise by locking/revalidating it and inserting the exclusion-protected block.
 */
export async function resolveReservationQuote(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    request: Pick<
      StaffReservationCreateRequest,
      | 'variant_id'
      | 'requested_interval'
      | 'event_date'
      | 'fulfillment_method'
      | 'payment_method_id'
    >;
  },
): Promise<ReservationQuote> {
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
    pricingMode: catalogue.variant.pricing_mode,
    baseRentalMinor: catalogue.variant.rental_price_minor,
    includedDurationMinutes: catalogue.variant.included_duration_minutes,
    extraDayPriceMinor: catalogue.variant.extra_day_price_minor,
  });
  const securityDeposit = parseMinorUnits(
    catalogue.variant.security_deposit_minor,
    'Security deposit',
  );
  const deliveryFee = resolveDeliveryFee(
    foundation.delivery_rules,
    input.request.fulfillment_method,
  );
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
    },
    delivery_snapshot: {
      fulfillment_method: input.request.fulfillment_method,
      fee_minor: deliveryFee.toString(),
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

export function computeRentalTotal(input: {
  requestedInterval: InstantInterval;
  pricingMode: 'fixed_duration' | 'daily';
  baseRentalMinor: string;
  includedDurationMinutes: number;
  extraDayPriceMinor: string;
}): { totalMinor: bigint; extraDayCount: number } {
  const startMs = BigInt(new Date(input.requestedInterval.start).getTime());
  const endMs = BigInt(new Date(input.requestedInterval.end).getTime());
  const durationMs = endMs - startMs;
  const includedMs = BigInt(input.includedDurationMinutes) * MINUTE_MS;
  assertMinimumRentalDuration({
    durationMs,
    pricingMode: input.pricingMode,
    includedDurationMinutes: input.includedDurationMinutes,
  });
  const extraDurationMs = durationMs > includedMs ? durationMs - includedMs : 0n;
  const extraDays = extraDurationMs === 0n ? 0n : (extraDurationMs + DAY_MS - 1n) / DAY_MS;

  const baseRental = parseMinorUnits(input.baseRentalMinor, 'Rental price');
  const extraDayPrice = parseMinorUnits(input.extraDayPriceMinor, 'Extra-day price');
  const totalMinor = assertSupportedAmount(
    baseRental + extraDays * extraDayPrice,
    'Rental total',
  );
  if (extraDays > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StateConflictError('Rental duration exceeds the supported quote range.');
  }
  return { totalMinor, extraDayCount: Number(extraDays) };
}

export function assertMinimumRentalDuration(input: {
  durationMs: bigint;
  pricingMode: 'fixed_duration' | 'daily';
  includedDurationMinutes: number;
}): void {
  if (input.pricingMode !== 'fixed_duration') return;
  const minimumMs = BigInt(input.includedDurationMinutes) * MINUTE_MS;
  if (input.durationMs >= minimumMs) return;
  throw new StateConflictError(
    `This clothing variant requires a minimum rental period of ${formatDuration(input.includedDurationMinutes)}.`,
  );
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

function formatDuration(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}

function resolveDeliveryFee(
  rules: Record<string, unknown>,
  fulfillmentMethod: FulfillmentMethod,
): bigint {
  if (fulfillmentMethod === 'pickup') return 0n;
  if (rules.enabled === false) {
    throw new StateConflictError('Delivery is disabled by the effective reservation policy.');
  }
  const configuredFee = rules.fee_minor;
  if (configuredFee === undefined || configuredFee === null || configuredFee === '') return 0n;
  return parseMinorUnits(configuredFee, 'Delivery fee');
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
