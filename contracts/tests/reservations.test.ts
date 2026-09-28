import { describe, expect, it } from 'vitest';

import {
  errorCode,
  holdIntentRequest,
  paymentReceiptSubmitRequest,
  reservationCancelRequest,
  reservationCompleteRequest,
  reservationConfirmRequest,
  reservationDetail,
  reservationListQuery,
  reservationListResponse,
  reservationPickupRequest,
  reservationInspectionRequest,
  reservationRejectRequest,
  reservationReturnRequest,
  reservationState,
  reservationSubmitRequest,
  reservationSummary,
  staffReservationCompleteRequest,
  staffReservationCompleteResponse,
  staffReservationCreateRequest,
  staffReservationIntakeQuery,
  staffReservationIntakeResponse,
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

  it('keeps staff reservation intake options bounded and free of payment destination secrets', () => {
    expect(staffReservationIntakeQuery.safeParse({}).success).toBe(true);
    expect(staffReservationIntakeQuery.safeParse({ customer_search: 'Ma' }).success).toBe(true);
    expect(staffReservationIntakeQuery.safeParse({ customer_search: 'M' }).success).toBe(false);
    expect(staffReservationIntakeQuery.safeParse({ customer_search: 'Maria', tenant_id: ids.branch }).success).toBe(false);

    expect(
      staffReservationIntakeResponse.safeParse({
        payment_methods: [
          { id: ids.paymentMethod, name: 'Cash', rail: 'cash' },
        ],
        customers: [
          { id: ids.customer, full_name: 'Maria Santos', phone: '09171234567', email: null, has_address: true },
        ],
      }).success,
    ).toBe(true);
    expect(
      staffReservationIntakeResponse.safeParse({
        payment_methods: [
          {
            id: ids.paymentMethod,
            name: 'GCash',
            rail: 'manual_qr',
            destination_snapshot: { account: 'secret' },
          },
        ],
        customers: [],
      }).success,
    ).toBe(false);
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

  it('allows the walk-in hold before customer entry without accepting a fake null customer', () => {
    expect(staffReservationCreateRequest.safeParse(baseStaffCreate).success).toBe(true);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: null,
      }).success,
    ).toBe(false);
  });

  it('accepts a new staff customer with phone or email and rejects an empty contact', () => {
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Walk-in Customer', phone: '09171234567', address: '123 Test Street' },
        },
      }).success,
    ).toBe(true);

    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'No Contact', address: '123 Test Street' },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Too Short', phone: '0917123456', address: '123 Test Street' },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Too Long', phone: '091712345678', address: '123 Test Street' },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Non Numeric', phone: '0917ABC4567', address: '123 Test Street' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires a bounded address for new reservation customers and permits only an inline address for existing customers', () => {
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Missing Address', phone: '09171234567' },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: { full_name: 'Blank Address', phone: '09171234567', address: '   ' },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: {
            full_name: 'Long Address',
            phone: '09171234567',
            address: 'A'.repeat(501),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'existing',
          customer_id: ids.customer,
          address: '123 Test Street',
        },
      }).success,
    ).toBe(true);
    expect(
      staffReservationCreateRequest.safeParse({
        ...baseStaffCreate,
        customer: {
          source: 'new',
          customer: {
            full_name: 'Long Social',
            phone: '09171234567',
            address: '123 Test Street',
            social_media: 'S'.repeat(321),
          },
        },
      }).success,
    ).toBe(false);
  });

  it('keeps guest checkout stricter than staff intake and rejects unknown authority fields', () => {
    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', email: 'guest@example.test', address: '123 Test Street' },
      }).success,
    ).toBe(true);

    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', phone: '09171234567', address: '123 Test Street' },
      }).success,
    ).toBe(false);

    expect(
      holdIntentRequest.safeParse({
        ...baseStaffCreate,
        contact: { full_name: 'Guest', email: 'guest@example.test', address: '123 Test Street' },
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

  it('keeps the staff completion intent narrow and returns only truthful pending/confirmed outcomes', () => {
    const request = staffReservationCompleteRequest.safeParse({
      version: 1,
      terms_accepted: true,
      customer: {
        source: 'new',
        customer: { full_name: 'Walk-in Customer', phone: '09171234567', address: '123 Test Street' },
      },
    });
    expect(request.success).toBe(true);
    expect(
      staffReservationCompleteRequest.safeParse({
        version: 1,
        terms_accepted: true,
        status: 'confirmed',
      }).success,
    ).toBe(false);

    expect(
      staffReservationCompleteResponse.safeParse({
        reservation: { ...baseSummary, status: 'pending_confirmation', version: 2 },
        completion_state: 'pending_confirmation',
        next_action: 'merchant_review',
      }).success,
    ).toBe(true);
    expect(
      staffReservationCompleteResponse.safeParse({
        reservation: { ...baseSummary, status: 'held' },
        completion_state: 'held',
        next_action: 'none',
      }).success,
    ).toBe(false);
    expect(
      staffReservationCompleteResponse.safeParse({
        reservation: { ...baseSummary, status: 'confirmed', version: 3 },
        completion_state: 'pending_confirmation',
        next_action: 'merchant_review',
      }).success,
    ).toBe(false);
  });

  it('bounds reservation list queries and rejects tenant or branch selectors', () => {
    expect(reservationListQuery.parse({}).sort).toBe('created_desc');

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
      }).success,
    ).toBe(false);
    expect(
      reservationListQuery.safeParse({
        pickup_end: '2026-10-31T00:00:00.000Z',
      }).success,
    ).toBe(false);

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

  it('allows an anonymous short hold in the staff list without inventing customer contact facts', () => {
    const result = reservationListResponse.safeParse({
      items: [
        {
          id: ids.reservation,
          reference_code: 'RSV-HOLD-1',
          status: 'held',
          customer: { customer_id: null, snapshot: null },
          line: {
            id: ids.line,
            variant_id: ids.variant,
            name_snapshot: 'Emerald Gown',
            rental_minor: '150000',
            deposit_minor: '50000',
            currency: 'PHP',
          },
          fulfillment_method: 'pickup',
          pickup_at: interval.start,
          due_at: interval.end,
          price_snapshot: baseSummary.price_snapshot,
          payment: null,
          version: 1,
          created_at: '2026-10-09T02:00:00.000Z',
        },
      ],
      page_meta: { next_cursor: null, has_more: false },
    });

    expect(result.success).toBe(true);
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
        snapshot: { full_name: 'Customer One', phone: '09171234567', email: null, address: '123 Test Street' },
      },
      lines: [
        {
          id: ids.line,
          variant_id: ids.variant,
          variant: { sku: 'EMERALD-M', size_label: 'M', color_label: 'Emerald' },
          current_asset_readiness: 'ready',
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
        method_name: 'Cash',
        rail: 'cash',
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

  it('keeps historical reservation snapshots readable when they predate address capture', () => {
    expect(
      reservationDetail.safeParse({
        id: ids.reservation,
        reference_code: 'RSV-LEGACY-1',
        status: 'held',
        branch_id: ids.branch,
        storefront_id: ids.storefront,
        customer: {
          customer_id: ids.customer,
          snapshot: { full_name: 'Legacy Customer', phone: null, email: 'legacy@example.test', address: null },
        },
        lines: [
          {
            id: ids.line,
            variant_id: ids.variant,
            variant: { sku: 'LEGACY-S', size_label: 'S', color_label: null },
            current_asset_readiness: null,
            line_number: 1,
            name_snapshot: 'Legacy Dress',
            measurements_snapshot: {},
            pricing_snapshot: { rental_minor: '150000', deposit_minor: '50000', currency: 'PHP' },
          },
        ],
        pickup_at: interval.start,
        due_at: interval.end,
        timezone_snapshot: 'Asia/Manila',
        event_date: '2026-10-11',
        delivery_snapshot: { fulfillment_method: 'pickup' },
        price_snapshot: baseSummary.price_snapshot,
        payment: null,
        hold_acquired_at: '2026-10-09T02:00:00.000Z',
        hold_expires_at: '2026-10-09T02:15:00.000Z',
        terms_accepted_at: null,
        submitted_at: null,
        confirmed_at: null,
        completed_at: null,
        custody_timeline: [],
        version: 1,
        created_at: '2026-10-09T02:00:00.000Z',
      }).success,
    ).toBe(true);
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
    expect(reservationCancelRequest.safeParse({ version: 1, reason: 'Customer contacted the store.' }).success).toBe(true);
    expect(reservationCancelRequest.safeParse({ version: 1, refund_amount_minor: '50000' }).success).toBe(false);
    expect(reservationPickupRequest.safeParse({ version: 1, condition_note: 'Ready at handover.' }).success).toBe(true);
    expect(reservationPickupRequest.safeParse({ version: 1, asset_id: ids.asset }).success).toBe(false);
    expect(reservationReturnRequest.safeParse({ version: 1, condition_note: 'Returned at counter.' }).success).toBe(true);
    expect(reservationReturnRequest.safeParse({ version: 1, readiness: 'ready' }).success).toBe(false);
    expect(reservationInspectionRequest.safeParse({ version: 5, readiness: 'needs_cleaning', condition_note: 'Normal cleaning.' }).success).toBe(true);
    expect(reservationInspectionRequest.safeParse({ version: 5, readiness: 'ready', asset_id: ids.asset }).success).toBe(false);
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
