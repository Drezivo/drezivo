import { describe, expect, it } from 'vitest';

import {
  errorCode,
  fittingActionResponse,
  fittingCancelRequest,
  fittingClosureCreateRequest,
  fittingClosureListQuery,
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
  fittingRejectRequest,
  fittingRescheduleRequest,
  fittingSettings,
  fittingSettingsUpdateRequest,
  fittingState,
  fittingWeeklyHours,
  fittingWeeklyHoursUpdateRequest,
  idempotentRequestHeaders,
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
  closure: '00000000-0000-4000-8000-000000000110',
};

const period = {
  start: '2026-10-10T02:00:00.000Z',
  end: '2026-10-10T03:00:00.000Z',
};

const weeklyHours = [
  {
    weekday: 'monday' as const,
    windows: [
      { starts_local: '09:00', ends_local: '12:00' },
      { starts_local: '13:00', ends_local: '17:00' },
    ],
  },
  { weekday: 'tuesday' as const, windows: [{ starts_local: '09:00', ends_local: '17:00' }] },
  { weekday: 'wednesday' as const, windows: [{ starts_local: '09:00', ends_local: '17:00' }] },
  { weekday: 'thursday' as const, windows: [{ starts_local: '09:00', ends_local: '17:00' }] },
  { weekday: 'friday' as const, windows: [{ starts_local: '09:00', ends_local: '17:00' }] },
  { weekday: 'saturday' as const, windows: [{ starts_local: '09:00', ends_local: '15:00' }] },
  { weekday: 'sunday' as const, windows: [] },
];

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

  it('models recurring breaks as non-overlapping gaps between weekly windows', () => {
    expect(fittingWeeklyHours.safeParse(weeklyHours).success).toBe(true);
  });

  it('rejects overlapping weekly fitting windows', () => {
    const overlapping = weeklyHours.map((day) =>
      day.weekday === 'monday'
        ? {
            ...day,
            windows: [
              { starts_local: '09:00', ends_local: '13:00' },
              { starts_local: '12:30', ends_local: '17:00' },
            ],
          }
        : day,
    );

    expect(fittingWeeklyHours.safeParse(overlapping).success).toBe(false);
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

  it('returns complete branch fitting settings without exposing internal slots', () => {
    const result = fittingSettings.safeParse({
      branch_id: ids.branch,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '30000',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      weekly_hours: weeklyHours,
      version: 4,
      updated_at: '2026-10-01T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('requires all seven weekdays on weekly-hours replacement', () => {
    expect(
      fittingWeeklyHoursUpdateRequest.safeParse({
        version: 1,
        weekly_hours: weeklyHours.slice(0, 6),
      }).success,
    ).toBe(false);
  });

  it('bounds date-specific closure reads and validates closure writes', () => {
    const results = [
      fittingClosureListQuery.safeParse({
        period_start: '2026-01-01T00:00:00.000Z',
        period_end: '2026-12-31T00:00:00.000Z',
      }).success,
      fittingClosureListQuery.safeParse({
        period_start: '2026-01-01T00:00:00.000Z',
        period_end: '2028-01-01T00:00:00.000Z',
      }).success,
      fittingClosureCreateRequest.safeParse({
        settings_version: 2,
        period: {
          start: '2026-12-24T01:00:00.000Z',
          end: '2026-12-24T09:00:00.000Z',
        },
        reason: 'Private event',
      }).success,
    ];

    expect(results).toEqual([true, false, true]);
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
