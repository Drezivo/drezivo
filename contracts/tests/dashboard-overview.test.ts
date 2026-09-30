import { describe, expect, it } from 'vitest';

import { dashboardOverviewResponse } from '../src/dashboard/overview';

const reservationId = '11111111-1111-4111-8111-111111111111';
const fittingId = '22222222-2222-4222-8222-222222222222';

function validOverview() {
  return {
    window: {
      timezone: 'Asia/Manila',
      as_of: '2026-09-30T03:00:00.000Z',
      today: { start: '2026-09-29T16:00:00.000Z', end: '2026-09-30T16:00:00.000Z' },
      upcoming_rentals: { start: '2026-09-30T03:00:00.000Z', end: '2026-10-06T16:00:00.000Z' },
      upcoming_fittings: { start: '2026-09-30T03:00:00.000Z', end: '2026-10-02T16:00:00.000Z' },
      current_month: { start: '2026-08-31T16:00:00.000Z', end: '2026-09-30T16:00:00.000Z' },
      previous_month: { start: '2026-07-31T16:00:00.000Z', end: '2026-08-31T16:00:00.000Z' },
    },
    metrics: {
      active_rentals: 2,
      pickups_today: 1,
      returns_today: 1,
      fittings_today: 1,
      payments_to_review: 0,
    },
    today_schedule: {
      items: [
        {
          id: `pickup:${reservationId}`,
          source: 'reservation' as const,
          source_id: reservationId,
          event_type: 'pickup' as const,
          period: { start: '2026-09-30T04:00:00.000Z', end: '2026-09-30T04:30:00.000Z' },
          customer_name: 'A customer',
          customer_phone: '555-0101',
          rental_items: [{ name: 'Evening Gown', rental_minor: '30000', currency: 'PHP' }],
          rental_days: 3,
          status: 'confirmed' as const,
        },
        {
          id: `fitting:${fittingId}`,
          source: 'fitting' as const,
          source_id: fittingId,
          event_type: 'fitting' as const,
          period: { start: '2026-09-30T05:00:00.000Z', end: '2026-09-30T06:00:00.000Z' },
          customer_name: 'Another customer',
          customer_phone: null,
          item_names: [],
          status: 'pending' as const,
        },
      ],
      total: 2,
      truncated: false,
    },
    upcoming_rentals: {
      items: [
        {
          id: reservationId,
          customer_name: 'A customer',
          item_names: ['Evening Gown'],
          pickup_at: '2026-09-30T04:00:00.000Z',
          due_at: '2026-10-01T04:00:00.000Z',
          status: 'confirmed' as const,
        },
      ],
      total: 1,
      truncated: false,
    },
    upcoming_fitting_appointments: {
      items: [
        {
          id: fittingId,
          customer_name: 'Another customer',
          garment_names: ['Evening Gown'],
          starts_at: '2026-09-30T05:00:00.000Z',
          ends_at: '2026-09-30T06:00:00.000Z',
          booking_channel: 'staff' as const,
          status: 'pending' as const,
        },
      ],
      total: 1,
      truncated: false,
    },
    business_performance: {
      currency: 'PHP',
      completed_rental_value: { current_minor: '30000', previous_minor: '20000' },
      completed_rentals: { current: 3, previous: 2 },
      average_rental_value: { current_minor: '10000', previous_minor: '10000' },
      new_customers: { current: 2, previous: 1 },
    },
  };
}

describe('dashboardOverviewResponse', () => {
  it('accepts strict branch-local projection windows and bounded result lists', () => {
    const parsed = dashboardOverviewResponse.parse(validOverview());
    expect(parsed.business_performance.currency).toBe('PHP');
    expect(parsed.today_schedule.truncated).toBe(false);
  });

  it('rejects unbounded rows, invalid money, and unapproved projection fields', () => {
    const tooManyAppointments = validOverview();
    tooManyAppointments.upcoming_fitting_appointments.items = Array.from({ length: 6 }, (_, index) => ({
      ...tooManyAppointments.upcoming_fitting_appointments.items[0]!,
      id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
    }));
    expect(() => dashboardOverviewResponse.parse(tooManyAppointments)).toThrow();

    const invalidMoney = validOverview();
    invalidMoney.business_performance.completed_rental_value.current_minor = '30.00';
    expect(() => dashboardOverviewResponse.parse(invalidMoney)).toThrow();

    const withContactData = validOverview();
    const firstEvent = withContactData.today_schedule.items[0];
    if (!firstEvent) throw new Error('expected one schedule fixture');
    const contactProjection = {
      ...withContactData,
      today_schedule: {
        ...withContactData.today_schedule,
        items: [
          { ...firstEvent, email: 'private@example.test' },
          ...withContactData.today_schedule.items.slice(1),
        ],
      },
    };
    expect(() => dashboardOverviewResponse.parse(contactProjection)).toThrow();
  });

  it('requires phone and rental details only for their matching event source', () => {
    const withoutPhone = validOverview();
    const pickup = withoutPhone.today_schedule.items[0];
    if (!pickup) throw new Error('expected a pickup fixture');
    const pickupWithoutPhone = { ...pickup };
    Reflect.deleteProperty(pickupWithoutPhone, 'customer_phone');
    withoutPhone.today_schedule.items[0] = pickupWithoutPhone;
    expect(() => dashboardOverviewResponse.parse(withoutPhone)).toThrow();

    const fittingWithRentalPrice = validOverview();
    const fitting = fittingWithRentalPrice.today_schedule.items[1];
    if (!fitting) throw new Error('expected a fitting fixture');
    const invalidFitting = {
      ...fitting,
      rental_items: [{ name: 'Evening Gown', rental_minor: '30000', currency: 'PHP' }],
    };
    const invalidProjection = {
      ...fittingWithRentalPrice,
      today_schedule: { ...fittingWithRentalPrice.today_schedule, items: [pickup, invalidFitting] },
    };
    expect(() => dashboardOverviewResponse.parse(invalidProjection)).toThrow();
  });
});
