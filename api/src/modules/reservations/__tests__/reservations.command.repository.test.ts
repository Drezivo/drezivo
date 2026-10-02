import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  appendExpiredReservationAuditEvents,
  appendExpiredReservationOutboxEvents,
  releaseExpiredReservationHolds,
  RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
  type ExpiredReservationHoldRow,
} from '../reservations.command.repository.js';

describe('expired reservation event batching', () => {
  it.each([1, 100])(
    'inserts audit and outbox events in two queries for %i expired holds',
    async (count) => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const client = { query } as unknown as PoolClient;
      const rows = Array.from({ length: count }, (_, index): ExpiredReservationHoldRow => ({
        reservation_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        version: index + 2,
      }));

      await appendExpiredReservationAuditEvents(client, {
        tenantId: 'tenant-id',
        requestId: 'request-id',
        rows,
      });
      await appendExpiredReservationOutboxEvents(client, { tenantId: 'tenant-id', rows });

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]?.[0]).toContain('WITH ORDINALITY');
      expect(query.mock.calls[0]?.[1]).toEqual([
        'tenant-id',
        'request-id',
        rows.map((row) => row.reservation_id),
        rows.map((row) => row.version),
      ]);
      expect(query.mock.calls[1]?.[0]).toContain('WITH ORDINALITY');
      expect(query.mock.calls[1]?.[1]).toEqual([
        'tenant-id',
        rows.map((row) => row.reservation_id),
        rows.map((row) => row.version),
      ]);
    },
  );

  it('does not issue insert queries for an empty batch', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await appendExpiredReservationAuditEvents(client, {
      tenantId: 'tenant-id',
      requestId: 'request-id',
      rows: [],
    });
    await appendExpiredReservationOutboxEvents(client, { tenantId: 'tenant-id', rows: [] });

    expect(query).not.toHaveBeenCalled();
  });

  it('locks at most one ordered reclaim batch and returns updated rows in that order', async () => {
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ reservation_id: firstId }, { reservation_id: secondId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { reservation_id: secondId, version: 3 },
          { reservation_id: firstId, version: 2 },
        ],
      });
    const client = { query } as unknown as PoolClient;

    const reclaimed = await releaseExpiredReservationHolds(client, {
      tenantId: 'tenant-id',
      branchId: 'branch-id',
      assetIds: ['asset-id'],
      batchSize: RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY r.id ASC');
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $4');
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE OF r');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'tenant-id',
      'branch-id',
      ['asset-id'],
      RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
    ]);
    expect(reclaimed).toEqual([
      { reservation_id: firstId, version: 2 },
      { reservation_id: secondId, version: 3 },
    ]);
  });
});
