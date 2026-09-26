import { describe, expect, it } from 'vitest';

import {
  centralPaymentsQuery,
  centralPaymentsResponse,
  dashboardFittingSummaryResponse,
  operationalCalendarQuery,
  operationalCalendarResponse,
} from '../src';

const ids = {
  branch: '00000000-0000-4000-8000-000000000201',
  reservation: '00000000-0000-4000-8000-000000000202',
  fitting: '00000000-0000-4000-8000-000000000203',
  payment: '00000000-0000-4000-8000-000000000204',
};

describe('BE-8 operational integration contracts', () => {
  it('bounds Calendar windows and accepts normalized reservation/fitting events', () => {
    expect(
      operationalCalendarQuery.safeParse({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      operationalCalendarQuery.safeParse({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-12-01T00:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(
      operationalCalendarResponse.safeParse({
        window: {
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-10-01T00:00:00.000Z',
        },
        events: [
          {
            id: `pickup:${ids.reservation}`,
            source: 'reservation',
            source_id: ids.reservation,
            event_type: 'pickup',
            branch_id: ids.branch,
            period: {
              start: '2026-09-10T02:00:00.000Z',
              end: '2026-09-10T02:30:00.000Z',
            },
            customer_name: 'Maria Santos',
            item_names: ['Evening Gown'],
            status: 'confirmed',
          },
          {
            id: `fitting:${ids.fitting}`,
            source: 'fitting',
            source_id: ids.fitting,
            event_type: 'fitting',
            branch_id: ids.branch,
            period: {
              start: '2026-09-11T02:00:00.000Z',
              end: '2026-09-11T03:00:00.000Z',
            },
            customer_name: 'Anna Cruz',
            item_names: ['Filipiniana'],
            status: 'pending',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('keeps Dashboard fitting summary operational and analytics-free', () => {
    const result = dashboardFittingSummaryResponse.safeParse({
      window: {
        today_start: '2026-09-27T00:00:00.000Z',
        today_end: '2026-09-28T00:00:00.000Z',
        upcoming_end: '2026-10-05T00:00:00.000Z',
      },
      fittings_today: 3,
      fittings_upcoming: 8,
      fittings_pending_review: 2,
      revenue_minor: '100000',
    });
    expect(result.success).toBe(false);
  });

  it('bounds central Payments and preserves reservation-versus-fitting source identity', () => {
    expect(
      centralPaymentsQuery.safeParse({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        source: 'fitting',
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      centralPaymentsQuery.safeParse({
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-12-31T00:00:00.000Z',
      }).success,
    ).toBe(false);

    const response = centralPaymentsResponse.safeParse({
      window: {
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
      },
      items: [
        {
          id: ids.payment,
          source: 'fitting',
          reservation_id: null,
          fitting_id: ids.fitting,
          customer_name: 'Maria Santos',
          payment_method_name: 'Cash',
          rail: 'cash',
          amount_minor: '500',
          currency: 'PHP',
          status: 'paid',
          evidence_status: 'not_required',
          latest_refund_status: null,
          active_refund_minor: '0',
          completed_refund_minor: '0',
          verified_at: '2026-09-10T02:00:00.000Z',
          created_at: '2026-09-10T01:00:00.000Z',
        },
      ],
    });
    expect(response.success).toBe(true);
  });

  it('rejects a central payment row that mixes reservation and fitting sources', () => {
    const result = centralPaymentsResponse.safeParse({
      window: {
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
      },
      items: [
        {
          id: ids.payment,
          source: 'fitting',
          reservation_id: ids.reservation,
          fitting_id: ids.fitting,
          customer_name: 'Maria Santos',
          payment_method_name: 'Cash',
          rail: 'cash',
          amount_minor: '500',
          currency: 'PHP',
          status: 'pending',
          evidence_status: 'not_required',
          latest_refund_status: null,
          active_refund_minor: '0',
          completed_refund_minor: '0',
          verified_at: null,
          created_at: '2026-09-10T01:00:00.000Z',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
