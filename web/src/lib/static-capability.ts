import type { PaymentEvidenceStatus, ReservationStatus } from './reservation-status';
import {
  decodeStaticReservationState,
  encodeStaticReservationState,
  getStaticItem,
  type StaticReservationStateSeed,
} from './static-storefront-client';

export interface StaticGuestReservationSummary {
  referenceNumber: string;
  status: ReservationStatus;
  item: {
    id: string;
    name: string;
    imageUrl: string;
    size: string;
  };
  pickupDate: string;
  returnDate: string;
  customer: {
    fullName: string;
    phone: string;
    email: string;
  };
  pickup: {
    method: 'self_pickup' | 'delivery';
    location?: string;
  };
  payment: {
    status: PaymentEvidenceStatus;
    method: 'gcash' | 'maya' | 'cash';
    reference?: string;
  };
  pricing: {
    rentalFeeDecimal: string;
    securityDepositDecimal: string;
    addOnsDecimal: string;
    discountDecimal: string;
    totalDecimal: string;
  };
}

export interface GuestCapabilityExchangeResult {
  reservationId: string;
  expiresAt: string;
}

export interface SubmitGuestDetailsInput {
  fullName: string;
  phone: string;
  email: string;
  eventDate?: string;
  pickupMethod: 'self_pickup' | 'delivery';
  deliveryAddress?: string;
  paymentMethod: 'gcash' | 'maya' | 'cash';
}

export interface StaticDetailsSubmissionResult {
  reservationId: string;
  summary: StaticGuestReservationSummary;
}

export interface StaticConfirmationResult extends StaticGuestReservationSummary {
  staticReservationId: string;
}

const DEMO_SEED: StaticReservationStateSeed = {
  storeSlug: 'luxe-rentals',
  itemId: 'emerald-evening-gown',
  size: 'M',
  pickupDate: '2026-10-10',
  returnDate: '2026-10-13',
  status: 'pending_confirmation',
  fullName: 'Maria Santos',
  phone: '+63 917 555 0112',
  email: 'maria@example.com',
  pickupMethod: 'self_pickup',
  paymentMethod: 'gcash',
};

function decimalToCents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  const normalizedFraction = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(normalizedFraction);
}

function centsToDecimal(value: bigint): string {
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, '0');
  return `${whole}.${fraction}`;
}

function buildReferenceNumber(state: StaticReservationStateSeed): string {
  const source = `${state.itemId}-${state.pickupDate}-${state.size}`;
  let checksum = 0;
  for (const character of source) checksum = (checksum * 31 + character.charCodeAt(0)) % 100000;
  return `DZR-${String(checksum).padStart(5, '0')}`;
}

function summaryFromState(state: StaticReservationStateSeed): StaticGuestReservationSummary | null {
  const item = getStaticItem(state.itemId);
  if (!item) return null;

  const rentalCents = decimalToCents(item.priceDecimal);
  const depositCents = decimalToCents(item.securityDepositDecimal);
  const paymentMethod = state.paymentMethod ?? 'gcash';
  const paymentStatus: PaymentEvidenceStatus =
    state.status === 'pending_confirmation'
      ? paymentMethod === 'cash'
        ? 'under_review'
        : 'awaiting_upload'
      : 'not_required';

  return {
    referenceNumber: buildReferenceNumber(state),
    status: state.status,
    item: {
      id: item.id,
      name: item.name,
      imageUrl: item.primaryImageUrl,
      size: state.size,
    },
    pickupDate: state.pickupDate,
    returnDate: state.returnDate,
    customer: {
      fullName: state.fullName ?? 'Guest Customer',
      phone: state.phone ?? '+63 900 000 0000',
      email: state.email ?? 'guest@example.com',
    },
    pickup: {
      method: state.pickupMethod ?? 'self_pickup',
      location:
        state.pickupMethod === 'delivery'
          ? state.deliveryAddress || 'Delivery address to be provided'
          : 'Quezon City, Metro Manila',
    },
    payment: {
      status: paymentStatus,
      method: paymentMethod,
    },
    pricing: {
      rentalFeeDecimal: item.priceDecimal,
      securityDepositDecimal: item.securityDepositDecimal,
      addOnsDecimal: '0.00',
      discountDecimal: '0.00',
      totalDecimal: centsToDecimal(rentalCents + depositCents),
    },
  };
}

function reservationIdFromCapability(rawSecret: string): string | null {
  const prefix = 'static-capability-';
  return rawSecret.startsWith(prefix) ? rawSecret.slice(prefix.length) : null;
}

export async function exchangeGuestCapability(
  rawSecret: string,
): Promise<GuestCapabilityExchangeResult> {
  const reservationId = reservationIdFromCapability(rawSecret);
  if (!reservationId || !decodeStaticReservationState(reservationId)) {
    throw new Error('This static reservation preview is no longer valid.');
  }

  return {
    reservationId,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export async function getGuestReservationByToken(
  rawSecret: string,
): Promise<StaticGuestReservationSummary | null> {
  const reservationId = reservationIdFromCapability(rawSecret);
  const state = reservationId ? decodeStaticReservationState(reservationId) : null;
  return summaryFromState(state ?? DEMO_SEED);
}

export async function getGuestReservationById(
  reservationId: string,
  _options?: { cookieHeader?: string },
): Promise<StaticGuestReservationSummary | null> {
  const state = decodeStaticReservationState(reservationId);
  return state ? summaryFromState(state) : null;
}

export async function submitGuestReservationDetails(
  reservationId: string,
  details: SubmitGuestDetailsInput,
  _idempotencyKey: string,
): Promise<StaticDetailsSubmissionResult> {
  const state = decodeStaticReservationState(reservationId);
  if (!state) throw new Error('The static reservation preview could not be loaded.');

  const nextState: StaticReservationStateSeed = {
    ...state,
    fullName: details.fullName,
    phone: details.phone,
    email: details.email,
    eventDate: details.eventDate,
    pickupMethod: details.pickupMethod,
    deliveryAddress: details.deliveryAddress,
    paymentMethod: details.paymentMethod,
  };
  const nextReservationId = encodeStaticReservationState(nextState);
  const summary = summaryFromState(nextState);
  if (!summary) throw new Error('The selected static clothing item no longer exists.');

  return { reservationId: nextReservationId, summary };
}

export async function confirmGuestReservation(
  reservationId: string,
  _idempotencyKey: string,
): Promise<StaticConfirmationResult> {
  const state = decodeStaticReservationState(reservationId);
  if (!state) throw new Error('The static reservation preview could not be loaded.');

  const nextState: StaticReservationStateSeed = {
    ...state,
    status: 'pending_confirmation',
  };
  const nextReservationId = encodeStaticReservationState(nextState);
  const summary = summaryFromState(nextState);
  if (!summary) throw new Error('The selected static clothing item no longer exists.');

  return { ...summary, staticReservationId: nextReservationId };
}
