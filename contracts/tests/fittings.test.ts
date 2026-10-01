import { describe, expect, it } from 'vitest';

import {
  errorCode,
  fittingActionResponse,
  fittingCancelRequest,
  fittingCompleteRequest,
  fittingCreateRequest,
  fittingDetail,
  fittingDurationMinutes,
  fittingGarmentPlanUpdateRequest,
  fittingIntakeQuery,
  fittingIntakeResponse,
  fittingListQuery,
  fittingListResponse,
  fittingNoShowRequest,
  fittingPaymentIntentCreateRequest,
  fittingPaymentReceiptAttachRequest,
  fittingPaymentVerifyRequest,
  fittingPaymentVerifyResponse,
  fittingRejectRequest,
  fittingRescheduleRequest,
  fittingSettings,
  fittingSettingsUpdateRequest,
  fittingState,
  idempotentRequestHeaders,
  refundCreateRequest,
  refundResolveRequest,
} from '../src';

const ids = {
  branch: '00000000-0000-4000-8000-000000000101',
  customer: '00000000-0000-4000-8000-000000000102',
  fitting: '00000000-0000-4000-8000-000000000103',
  linePreference: '00000000-0000-4000-8000-000000000104',
  lineGuaranteed: '00000000-0000-4000-8000-000000000105',
  variantPreference: '00000000-0000-4000-8000-000000000106',
  variantGuaranteed: '00000000-0000-4000-8000-000000000107',
  asset: '00000000-0000-4000-8000-000000000108',
  payment: '00000000-0000-4000-8000-000000000109',
  paymentMethod: '00000000-0000-4000-8000-000000000111',
  paymentReceipt: '00000000-0000-4000-8000-000000000112',
  file: '00000000-0000-4000-8000-000000000113',
  refund: '00000000-0000-4000-8000-000000000114',
};

const period = {
  start: '2026-10-10T02:00:00.000Z',
  end: '2026-10-10T03:00:00.000Z',
};

const baseDetail = {
  id: ids.fitting,
  branch_id: ids.branch,
  booking_channel: 'staff' as const,
  status: 'pending' as const,
  period,
  timezone_snapshot: 'Asia/Manila',
  customer: {
    id: ids.customer,
    full_name: 'Maria Santos',
    phone: '09171234567',
    email: null,
    address: null,
    social_media: null,
  },
  garments: [
    {
      id: ids.linePreference,
      variant: {
        variant_id: ids.variantPreference,
        product_name: 'Modern Filipiniana',
        sku: 'MF-S-IVORY',
        size_label: 'S',
        color_label: 'Ivory',
      },
      garment_mode: 'preference' as const,
      assigned_asset: null,
    },
    {
      id: ids.lineGuaranteed,
      variant: {
        variant_id: ids.variantGuaranteed,
        product_name: 'Classic Barong',
        sku: 'CB-M-CREAM',
        size_label: 'M',
        color_label: 'Cream',
      },
      garment_mode: 'guaranteed' as const,
      assigned_asset: {
        id: ids.asset,
        asset_code: 'BARONG-M-003',
      },
    },
  ],
  fee: {
    fee_minor: '30000',
    currency: 'PHP',
    payment: null,
  },
  internal_note: null,
  terminal_reason: null,
  attention: 'none' as const,
  allowed_actions: ['confirm', 'reject', 'cancel', 'reschedule', 'update_garments', 'update_note'] as const,
  version: 1,
  created_at: '2026-10-01T01:00:00.000Z',
};

describe('fitting contracts', () => {
  it('keeps the canonical fitting lifecycle closed', () => {
    expect(fittingState.options).toEqual([
      'pending',
      'confirmed',
      'completed',
      'rejected',
      'cancelled',
      'no_show',
    ]);
  });

  it('creates an existing-customer fitting without accepting browser-owned duration, fee, status, branch, or asset fields', () => {
    const result = fittingCreateRequest.safeParse({
      customer: { source: 'existing', customer_id: ids.customer },
      starts_at: period.start,
      garments: [{ variant_id: ids.variantGuaranteed, garment_mode: 'guaranteed' }],
      duration_minutes: 60,
      fee_minor: '30000',
      status: 'confirmed',
      branch_id: ids.branch,
      asset_id: ids.asset,
    });

    expect(result.success).toBe(false);
  });

  it('keeps existing-customer lookup bounded and advisory', () => {
    const result = fittingIntakeResponse.safeParse({
      customers: [
        {
          id: ids.customer,
          full_name: 'Maria Santos',
          phone: '09171234567',
          email: null,
        },
      ],
    });

    expect([
      fittingIntakeQuery.safeParse({ customer_search: 'Ma' }).success,
      fittingIntakeQuery.safeParse({ customer_search: 'M' }).success,
      result.success,
    ]).toEqual([true, false, true]);
  });

  it('accepts a new walk-in with full name plus one usable contact method', () => {
    const result = fittingCreateRequest.safeParse({
      customer: {
        source: 'new',
        customer: { full_name: 'Walk-in Customer', phone: '09171234567' },
      },
      starts_at: period.start,
      garments: [{ variant_id: ids.variantPreference, garment_mode: 'preference' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts optional bounded walk-in address and social-media fields', () => {
    const request = {
      customer: {
        source: 'new' as const,
        customer: {
          full_name: 'Walk-in Customer',
          phone: '09171234567',
          address: '123 Test Street',
          social_media: '@walkin',
        },
      },
      starts_at: period.start,
      garments: [{ variant_id: ids.variantPreference, garment_mode: 'preference' as const }],
    };

    expect(fittingCreateRequest.safeParse(request).success).toBe(true);
    expect(
      fittingCreateRequest.safeParse({
        ...request,
        customer: {
          ...request.customer,
          customer: { ...request.customer.customer, address: '   ' },
        },
      }).success,
    ).toBe(false);
    expect(
      fittingCreateRequest.safeParse({
        ...request,
        customer: {
          ...request.customer,
          customer: { ...request.customer.customer, social_media: 'S'.repeat(321) },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a name-only walk-in', () => {
    const result = fittingCreateRequest.safeParse({
      customer: {
        source: 'new',
        customer: { full_name: 'Name Only' },
      },
      starts_at: period.start,
      garments: [{ variant_id: ids.variantPreference, garment_mode: 'preference' }],
    });

    expect(result.success).toBe(false);
  });

  it('keeps guaranteed asset choice server-owned in garment-plan requests', () => {
    const result = fittingGarmentPlanUpdateRequest.safeParse({
      version: 2,
      garments: [
        {
          variant_id: ids.variantGuaranteed,
          garment_mode: 'guaranteed',
          asset_id: ids.asset,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('enforces guaranteed-versus-preference asset truth in fitting detail', () => {
    const invalid = {
      ...baseDetail,
      garments: [
        {
          ...baseDetail.garments[0],
          garment_mode: 'preference' as const,
          assigned_asset: { id: ids.asset, asset_code: 'SHOULD-NOT-BE-HERE' },
        },
      ],
    };

    expect(fittingDetail.safeParse(invalid).success).toBe(false);
  });

  it('keeps appointment state independent from an unpaid fitting fee', () => {
    const confirmed = {
      ...baseDetail,
      status: 'confirmed' as const,
      fee: {
        fee_minor: '30000',
        currency: 'PHP',
        payment: {
          id: ids.payment,
          status: 'pending' as const,
          evidence_status: 'awaiting_upload' as const,
          amount_minor: '30000',
          currency: 'PHP',
          verified_at: null,
        },
      },
      allowed_actions: [
        'cancel',
        'complete',
        'mark_no_show',
        'reschedule',
        'update_garments',
        'update_note',
      ] as const,
    };

    expect(fittingDetail.safeParse(confirmed).success).toBe(true);
  });

  it('requires terminal reasons only for rejected/cancelled fitting details', () => {
    const rejectedWithoutReason = {
      ...baseDetail,
      status: 'rejected' as const,
      allowed_actions: [] as const,
    };

    expect(fittingDetail.safeParse(rejectedWithoutReason).success).toBe(false);
  });

  it('bounds fitting list date windows and rejects branch selectors', () => {
    const results = [
      fittingListQuery.safeParse({
        period_start: '2026-10-01T00:00:00.000Z',
        period_end: '2026-10-31T00:00:00.000Z',
      }).success,
      fittingListQuery.safeParse({
        period_start: '2026-10-01T00:00:00.000Z',
        period_end: '2026-11-02T00:00:00.000Z',
      }).success,
      fittingListQuery.safeParse({ branch_id: ids.branch }).success,
    ];

    expect(results).toEqual([true, false, false]);
  });

  it('parses a bounded list response without capacity-slot internals', () => {
    const listItem = {
      id: ids.fitting,
      status: 'pending' as const,
      period,
      customer: { id: ids.customer, full_name: 'Maria Santos' },
      garments: baseDetail.garments.map(({ assigned_asset: _assignedAsset, ...line }) => line),
      fee: baseDetail.fee,
      attention: 'none' as const,
      version: 1,
      created_at: baseDetail.created_at,
    };

    expect(
      fittingListResponse.safeParse({
        items: [listItem],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(true);
  });

  it('requires reasons for reject/cancel but not complete/no-show', () => {
    const results = [
      fittingRejectRequest.safeParse({ version: 1 }).success,
      fittingCancelRequest.safeParse({ version: 1 }).success,
      fittingRejectRequest.safeParse({ version: 1, reason: 'Cannot accommodate request.' }).success,
      fittingCancelRequest.safeParse({ version: 1, reason: 'Customer cancelled.' }).success,
      fittingCompleteRequest.safeParse({ version: 1 }).success,
      fittingNoShowRequest.safeParse({ version: 1 }).success,
    ];

    expect(results).toEqual([false, false, true, true, true, true]);
  });

  it('keeps reschedule narrow and derives duration server-side', () => {
    const results = [
      fittingRescheduleRequest.safeParse({ version: 1, starts_at: '2026-10-11T02:30:00.000Z' }).success,
      fittingRescheduleRequest.safeParse({
        version: 1,
        starts_at: '2026-10-11T02:30:00.000Z',
        duration_minutes: 90,
      }).success,
    ];

    expect(results).toEqual([true, false]);
  });

  it('enforces the strict 30-minute duration rule', () => {
    const results = [30, 45, 60, 90].map((value) => fittingDurationMinutes.safeParse(value).success);

    expect(results).toEqual([true, false, true, true]);
  });

  it('rejects malformed fitting timestamps, money, and state values', () => {
    const results = [
      fittingCreateRequest.safeParse({
        customer: { source: 'existing', customer_id: ids.customer },
        starts_at: 'not-a-timestamp',
        garments: [{ variant_id: ids.variantPreference, garment_mode: 'preference' }],
      }).success,
      fittingSettingsUpdateRequest.safeParse({
        version: 1,
        enabled: true,
        capacity: 2,
        duration_minutes: 60,
        fee_minor: '-1',
      }).success,
      fittingState.safeParse('paid').success,
    ];

    expect(results).toEqual([false, false, false]);
  });

  it('keeps fitting payment intent and evidence commands narrow and finance-owned', () => {
    const results = [
      fittingPaymentIntentCreateRequest.safeParse({ payment_method_id: ids.paymentMethod }).success,
      fittingPaymentIntentCreateRequest.safeParse({
        payment_method_id: ids.paymentMethod,
        amount_minor: '30000',
      }).success,
      fittingPaymentReceiptAttachRequest.safeParse({ file_id: ids.file }).success,
      fittingPaymentReceiptAttachRequest.safeParse({
        file_id: ids.file,
        payment_status: 'paid',
      }).success,
    ];

    expect(results).toEqual([true, false, true, false]);
  });

  it('keeps fitting payment verification independent from appointment version/state intent', () => {
    const results = [
      fittingPaymentVerifyRequest.safeParse({
        verified_amount_minor: '30000',
        merchant_reference: 'GCASH-123',
      }).success,
      fittingPaymentVerifyRequest.safeParse({
        verified_amount_minor: '30000',
        version: 2,
        status: 'confirmed',
      }).success,
      fittingPaymentVerifyRequest.safeParse({
        verified_amount_minor: '0',
      }).success,
    ];

    expect(results).toEqual([true, false, false]);
  });

  it('keeps fitting-fee refund creation explicit, positive, and purpose-specific', () => {
    const results = [
      refundCreateRequest.safeParse({
        payment_id: ids.payment,
        amount_minor: '30000',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'Approved fitting-fee refund.',
      }).success,
      refundCreateRequest.safeParse({
        payment_id: ids.payment,
        amount_minor: '0',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'Zero should fail.',
      }).success,
    ];

    expect(results).toEqual([true, false]);
  });

  it('models manual refund resolution separately from fitting lifecycle state', () => {
    const results = [
      refundResolveRequest.safeParse({
        status: 'completed',
        merchant_reference: 'REFUND-123',
        resolution_note: 'Owner verified external refund completion.',
      }).success,
      refundResolveRequest.safeParse({
        status: 'failed',
        resolution_note: 'External refund failed and needs operator follow-up.',
      }).success,
      refundResolveRequest.safeParse({
        status: 'processing',
        resolution_note: 'Client cannot set processing through this V1 resolution command.',
      }).success,
      refundResolveRequest.safeParse({
        refund_id: ids.refund,
        status: 'completed',
        resolution_note: 'Refund id belongs in the route/context, not the body.',
      }).success,
    ];

    expect(results).toEqual([true, true, false, false]);
  });

  it('can expose a paid fitting payment while the appointment remains independently confirmed', () => {
    const paidDetail = {
      ...baseDetail,
      status: 'confirmed' as const,
      fee: {
        fee_minor: '30000',
        currency: 'PHP',
        payment: {
          id: ids.payment,
          status: 'paid' as const,
          evidence_status: 'verified' as const,
          amount_minor: '30000',
          currency: 'PHP',
          verified_at: '2026-10-01T02:00:00.000Z',
        },
      },
      allowed_actions: ['cancel', 'reschedule', 'update_garments', 'update_note'] as const,
    };
    const response = fittingPaymentVerifyResponse.safeParse({
      fitting: paidDetail,
      payment_id: ids.payment,
      payment_status: 'paid',
      verified_amount_minor: '30000',
      verified_at: '2026-10-01T02:00:00.000Z',
    });

    expect(response.success).toBe(true);
  });

  it('rejects a fitting payment projection whose currency disagrees with the fee snapshot', () => {
    const invalid = {
      ...baseDetail,
      fee: {
        fee_minor: '30000',
        currency: 'PHP',
        payment: {
          id: ids.payment,
          status: 'pending' as const,
          evidence_status: 'awaiting_upload' as const,
          amount_minor: '30000',
          currency: 'USD',
          verified_at: null,
        },
      },
    };

    expect(fittingDetail.safeParse(invalid).success).toBe(false);
  });

  it('keeps branch currency/timezone and hidden capacity slots out of settings mutation authority', () => {
    const result = fittingSettingsUpdateRequest.safeParse({
      version: 1,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '30000',
      currency: 'USD',
      timezone: 'UTC',
      slot_ids: ['00000000-0000-4000-8000-000000000111'],
    });

    expect(result.success).toBe(false);
  });

  it('returns fitting-specific settings without weekly schedule ownership', () => {
    const scalarSettings = {
      branch_id: ids.branch,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '30000',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      version: 4,
      updated_at: '2026-10-01T00:00:00.000Z',
    };

    expect(fittingSettings.safeParse(scalarSettings).success).toBe(true);
    expect(
      fittingSettings.safeParse({ ...scalarSettings, weekly_hours: [] }).success,
    ).toBe(false);
    expect(
      fittingSettings.safeParse({ ...scalarSettings, closures: [] }).success,
    ).toBe(false);
  });

  it('extends the shared stable error vocabulary with schedule conflict semantics', () => {
    expect(errorCode.safeParse('SCHEDULE_CONFLICT').success).toBe(true);
  });

  it('reuses the standard idempotency key contract for fitting mutations', () => {
    expect(idempotentRequestHeaders.safeParse({ idempotency_key: 'fit_create_123456' }).success).toBe(true);
  });

  it('returns the authoritative fitting after an action command', () => {
    expect(fittingActionResponse.safeParse({ fitting: baseDetail }).success).toBe(true);
  });
});
