import { describe, expect, it } from 'vitest';

import {
  createAssetMaintenanceBlockRequest,
  createAssetMaintenanceBlockResponse,
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
});
