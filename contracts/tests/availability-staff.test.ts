import { describe, expect, it } from 'vitest';

import {
  createAssetMaintenanceBlockRequest,
  createAssetMaintenanceBlockResponse,
  staffReservationAvailabilityCalendarQuery,
  staffReservationAvailabilityCalendarResponse,
  staffReservationAvailabilityCheckQuery,
} from '../src';

const ids = {
  asset: '00000000-0000-4000-8000-000000000001',
  branch: '00000000-0000-4000-8000-000000000002',
  workOrder: '00000000-0000-4000-8000-000000000003',
  allocation: '00000000-0000-4000-8000-000000000004',
};

const start = '2026-09-22T08:00:00.000Z';
const end = '2026-09-23T08:00:00.000Z';

describe('staff availability maintenance contracts', () => {
  it('accepts bounded canonical maintenance/manual blocks and rejects browser authority fields', () => {
    expect(
      createAssetMaintenanceBlockRequest.safeParse({
        kind: 'repair',
        period: { start, end },
        reason: 'Zipper repair',
      }).success,
    ).toBe(true);

    expect(
      createAssetMaintenanceBlockRequest.safeParse({
        kind: 'manual_block',
        period: { start, end },
        reason: 'Owner unavailable',
        tenant_id: '00000000-0000-4000-8000-000000000099',
        branch_id: ids.branch,
        is_blocking: false,
      }).success,
    ).toBe(false);
  });

  it('rejects empty, reversed, and excessively long periods', () => {
    expect(
      createAssetMaintenanceBlockRequest.safeParse({
        kind: 'cleaning',
        period: { start, end: start },
        reason: 'Cleaning',
      }).success,
    ).toBe(false);

    expect(
      createAssetMaintenanceBlockRequest.safeParse({
        kind: 'repair',
        period: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2027-01-03T00:00:00.000Z',
        },
        reason: 'Too long',
      }).success,
    ).toBe(false);
  });

  it('defines the canonical work-order/allocation response shape', () => {
    expect(
      createAssetMaintenanceBlockResponse.safeParse({
        work_order_id: ids.workOrder,
        allocation_id: ids.allocation,
        asset_id: ids.asset,
        branch_id: ids.branch,
        kind: 'repair',
        period: { start, end },
        status: 'open',
        is_blocking: true,
        created_at: '2026-09-21T23:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('bounds staff reservation calendar previews and exact-time checks', () => {
    const variantId = '00000000-0000-4000-8000-000000000005';
    expect(
      staffReservationAvailabilityCalendarQuery.safeParse({
        variant_id: variantId,
        start_date: '2026-10-01',
        end_date: '2026-10-31',
      }).success,
    ).toBe(true);
    expect(
      staffReservationAvailabilityCalendarQuery.safeParse({
        variant_id: variantId,
        start_date: '2026-10-31',
        end_date: '2026-10-01',
      }).success,
    ).toBe(false);
    expect(
      staffReservationAvailabilityCalendarQuery.safeParse({
        variant_id: variantId,
        start_date: '2026-10-01',
        end_date: '2027-01-01',
      }).success,
    ).toBe(false);

    expect(
      staffReservationAvailabilityCheckQuery.safeParse({
        variant_id: variantId,
        pickup_at: '2026-10-10T02:00:00.000Z',
        due_at: '2026-10-13T02:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      staffReservationAvailabilityCheckQuery.safeParse({
        variant_id: variantId,
        pickup_at: '2026-10-13T02:00:00.000Z',
        due_at: '2026-10-10T02:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('defines the branch-local variant calendar response without exposing physical asset ids', () => {
    const parsed = staffReservationAvailabilityCalendarResponse.parse({
      variant_id: '00000000-0000-4000-8000-000000000005',
      timezone: 'Asia/Manila',
      window: { start_date: '2026-10-01', end_date: '2026-10-31' },
      active_assets: 2,
      ready_assets: 2,
      pricing: {
        pricing_mode: 'fixed_duration',
        rental_price_minor: '50000',
        security_deposit_minor: '20000',
        currency: 'PHP',
        included_duration_minutes: 4320,
        minimum_duration_minutes: 4320,
        extra_day_price_minor: '15000',
        prep_minutes: 60,
        turnaround_minutes: 1440,
      },
      days: [
        {
          date: '2026-10-10',
          state: 'limited',
          active_assets: 2,
          ready_assets: 2,
          available_assets: 1,
          reserved_assets: 1,
          rented_assets: 0,
          fitting_assets: 0,
          maintenance_assets: 0,
          transfer_assets: 0,
        },
      ],
    });

    expect(parsed.days[0]).toMatchObject({ state: 'limited', available_assets: 1 });
    expect(parsed.days[0]).not.toHaveProperty('asset_id');
    expect(parsed.days[0]).not.toHaveProperty('asset_ids');
  });
});
