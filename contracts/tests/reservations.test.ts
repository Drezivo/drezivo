import { describe, expect, it } from 'vitest';

import {
  errorCode,
  holdIntentRequest,
  paymentReceiptSubmitRequest,
  reservationCompleteRequest,
  reservationConfirmRequest,
  reservationDetail,
  reservationListQuery,
  reservationRejectRequest,
  reservationState,
  reservationSubmitRequest,
  reservationSummary,
  staffReservationCreateRequest,
} from '../src';

const ids = {
  customer: '00000000-0000-4000-8000-000000000001',
  variant: '00000000-0000-4000-8000-000000000002',
  paymentMethod: '00000000-0000-4000-8000-000000000003',
  reservation: '00000000-0000-4000-8000-000000000004',
  storefront: '00000000-0000-4000-8000-000000000005',
  branch: '00000000-0000-4000-8000-000000000006',
  line: '00000000-0000-4000-8000-000000000007',
  asset: '00000000-0000-4000-8000-000000000008',
  payment: '00000000-0000-4000-8000-000000000009',
  file: '00000000-0000-4000-8000-000000000010',
};

const interval = {
  start: '2026-10-10T02:00:00.000Z',
  end: '2026-10-13T02:00:00.000Z',
};

const baseStaffCreate = {
  variant_id: ids.variant,
  requested_interval: interval,
  event_date: '2026-10-11',
  fulfillment_method: 'pickup' as const,
  payment_method_id: ids.paymentMethod,
};

const baseSummary = {
  id: ids.reservation,
  reference_code: 'RSV-0001',
  status: 'held' as const,
  branch_id: ids.branch,
  storefront_id: ids.storefront,
  variant_id: ids.variant,
  payment_method_id: ids.paymentMethod,
  fulfillment_method: 'pickup' as const,
  pickup_at: interval.start,
  due_at: interval.end,
  timezone_snapshot: 'Asia/Manila',
  event_date: '2026-10-11',
  price_snapshot: {
    rental_total_minor: '150000',
    security_required_minor: '50000',
    due_now_minor: '50000',
    currency: 'PHP',
  },
  hold_expires_at: '2026-10-09T02:15:00.000Z',
  version: 1,
  created_at: '2026-10-09T02:00:00.000Z',
};

describe('reservation contracts', () => {
  it('keeps the reservation lifecycle vocabulary closed and canonical', () => {
    expect(reservationState.options).toEqual([
      'held',
      'pending_confirmation',
      'confirmed',
      'picked_up',
      'returned',
      'completed',
      'cancelled',
      'expired',
      'rejected',
    ]);
    expect(reservationState.safeParse('paid').success).toBe(false);
  });

  it('accepts staff creation for an existing customer without accepting browser authority', () => {
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: { source: 'existing', customer_id: ids.customer },
      }).success,
    ).toBe(true);

    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: { source: 'existing', customer_id: ids.customer },
        tenant_id: '00000000-0000-4000-8000-000000000099',
        branch_id: ids.branch,
        asset_id: ids.asset,
        rental_total_minor: '100',
        status: 'confirmed',
      }).success,
    ).toBe(false);
  });

  it('accepts a new staff customer with phone or email and rejects an empty contact', () => {
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Walk-in Customer', phone: '09171234567' },
        },
      }).success,
    ).toBe(true);

    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'No Contact' },
        },
      }).success,
    ).toBe(false);
  });

  it('keeps guest checkout stricter than staff intake and rejects unknown authority fields', () => {
    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', email: 'guest@example.test' },
      }).success,
    ).toBe(true);

    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', phone: '09171234567' },
      }).success,
    ).toBe(false);

    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', email: 'guest@example.test' },
        allocation_id: '00000000-0000-4000-8000-000000000011',
      }).success,
    ).toBe(false);
  });

  it('uses date-only event dates and timezone-safe instants for pickup/due windows', () => {
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: { source: 'existing', customer_id: ids.customer },
        event_date: '2026-10-11T00:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: { source: 'existing', customer_id: ids.customer },
        requested_interval: { start: '2026-10-13T02:00:00.000Z', end: '2026-10-10T02:00:00.000Z' },
      }).success,
    ).toBe(false);
  });

  it('bounds reservation list queries and rejects tenant or branch selectors', () => {
    expect(
      reservationListQuery.safeParse({
        status: 'confirmed',
        pickup_start: '2026-10-01T00:00:00.000Z',
        pickup_end: '2026-10-31T00:00:00.000Z',
        sort: 'pickup_asc',
      }).success,
    ).toBe(true);

    expect(
      reservationListQuery.safeParse({
        pickup_start: '2026-10-01T00:00:00.000Z',
        pickup_end: '2026-11-02T00:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(
      reservationListQuery.safeParse({
        search: 'RSV-0001',
        branch_id: ids.branch,
      }).success,
    ).toBe(false);
  });

  it('defines an authoritative detail projection with line snapshots, payment separation, and custody timeline', () => {
    const result = reservationDetail.safeParse({
      id: ids.reservation,
      reference_code: 'RSV-0001',
      status: 'picked_up',
      branch_id: ids.branch,
      storefront_id: ids.storefront,
      customer: {
        customer_id: ids.customer,
        snapshot: { full_name: 'Customer One', phone: '09171234567', email: null },
      },
      lines: [
        {
          id: ids.line,
          variant_id: ids.variant,
          line_number: 1,
          name_snapshot: 'Emerald Gown',
          measurements_snapshot: { bust: 91.5, waist: 72 },
          pricing_snapshot: { rental_minor: '150000', deposit_minor: '50000', currency: 'PHP' },
        },
      ],
      pickup_at: interval.start,
      due_at: interval.end,
      timezone_snapshot: 'Asia/Manila',
      event_date: '2026-10-11',
      delivery_snapshot: { fulfillment_method: 'pickup' },
      price_snapshot: baseSummary.price_snapshot,
      payment: {
        id: ids.payment,
        payment_method_id: ids.paymentMethod,
        status: 'paid',
        evidence_status: 'verified',
        amount_minor: '200000',
        currency: 'PHP',
        verified_at: '2026-10-09T03:00:00.000Z',
      },
      hold_acquired_at: '2026-10-09T02:00:00.000Z',
      hold_expires_at: null,
      terms_accepted_at: '2026-10-09T02:05:00.000Z',
      submitted_at: '2026-10-09T02:06:00.000Z',
      confirmed_at: '2026-10-09T03:00:00.000Z',
      completed_at: null,
      custody_timeline: [
        {
          event_kind: 'pickup',
          asset_id: ids.asset,
          reservation_line_id: ids.line,
          occurred_at: interval.start,
          condition_note: 'Released in good condition.',
        },
      ],
      version: 3,
      created_at: '2026-10-09T02:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('does not expose an updated_at field that the reservation table does not persist', () => {
    expect(reservationSummary.safeParse(baseSummary).success).toBe(true);
    expect(
      reservationSummary.safeParse({
        ...baseSummary,
        updated_at: '2026-10-09T04:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('keeps lifecycle commands strict and version guarded', () => {
    expect(reservationSubmitRequest.safeParse({ version: 1, terms_accepted: true }).success).toBe(true);
    expect(reservationSubmitRequest.safeParse({ version: 1, terms_accepted: false }).success).toBe(false);
    expect(reservationConfirmRequest.safeParse({ version: 1, status: 'confirmed' }).success).toBe(false);
    expect(reservationRejectRequest.safeParse({ version: 1, reason: 'Unable to verify payment.' }).success).toBe(true);
    expect(reservationCompleteRequest.safeParse({ version: 0 }).success).toBe(false);
  });

  it('reuses the finance evidence command without granting payment verification authority', () => {
    expect(
      paymentReceiptSubmitRequest.safeParse({
        payment_id: ids.payment,
        file_id: ids.file,
      }).success,
    ).toBe(true);
    expect(
      paymentReceiptSubmitRequest.safeParse({
        payment_id: ids.payment,
        file_id: ids.file,
        evidence_status: 'verified',
      }).success,
    ).toBe(false);
  });

  it('publishes stable reservation-specific failure codes while keeping foreign resources concealed as NOT_FOUND', () => {
    expect(errorCode.options).toEqual(
      expect.arrayContaining([
        'CAPACITY_CONFLICT',
        'HOLD_EXPIRED',
        'STALE_VERSION',
        'INVALID_RESERVATION_TRANSITION',
        'ASSET_UNAVAILABLE',
        'ASSET_UNREADY',
        'PAYMENT_PREREQUISITE_FAILED',
        'NOT_FOUND',
      ]),
    );
  });
});
