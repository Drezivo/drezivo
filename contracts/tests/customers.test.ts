import { describe, expect, it } from 'vitest';

import {
  customerArchiveRequest,
  customerArchiveResponse,
  customerDetailResponse,
  customerEditRequest,
  customerFittingHistoryResponse,
  customerHistoryQuery,
  customerListQuery,
  customerListResponse,
  customerReservationHistoryResponse,
  customerSummaryResponse,
} from '../src';

const ids = {
  customer: '00000000-0000-4000-8000-000000000101',
  reservation: '00000000-0000-4000-8000-000000000102',
  fitting: '00000000-0000-4000-8000-000000000103',
};

const createdAt = '2026-09-01T02:00:00.000Z';
const updatedAt = '2026-09-28T02:00:00.000Z';

const activeDetail = {
  id: ids.customer,
  full_name: 'Maria Santos',
  phone: '09175550101',
  email: 'maria@example.test',
  address: '24 Sampaguita Street, Quezon City',
  social_media: '@maria.santos',
  notes: 'Prefers afternoon pickup.',
  status: 'active' as const,
  archived_at: null,
  reservation_count: 4,
  fitting_count: 2,
  completed_engagement_count: 5,
  last_activity: { type: 'reservation' as const, at: '2026-09-24T06:00:00.000Z' },
  next_activity: { type: 'fitting' as const, at: '2026-10-03T05:00:00.000Z' },
  created_at: createdAt,
  updated_at: updatedAt,
};

describe('customer contracts', () => {
  it('defaults the customer directory to active profiles and bounded pagination', () => {
    expect(customerListQuery.parse({})).toEqual({ limit: 20, status: 'active' });
  });

  it('keeps customer directory filters strict and server-scoped', () => {
    expect(
      customerListQuery.safeParse({
        limit: 10,
        status: 'all',
        search: 'Maria',
        tenant_id: '00000000-0000-4000-8000-000000000999',
      }).success,
    ).toBe(false);
  });

  it('validates the paginated directory response with shared activity and page-meta shapes', () => {
    expect(
      customerListResponse.safeParse({
        items: [
          {
            id: ids.customer,
            full_name: 'Maria Santos',
            phone: '09175550101',
            email: 'maria@example.test',
            status: 'active',
            reservation_count: 4,
            fitting_count: 2,
            last_activity: { type: 'reservation', at: '2026-09-24T06:00:00.000Z' },
            next_activity: { type: 'fitting', at: '2026-10-03T05:00:00.000Z' },
            created_at: createdAt,
          },
        ],
        page_meta: { next_cursor: 'customer-cursor', has_more: true },
      }).success,
    ).toBe(true);
  });

  it('keeps summary metrics nonnegative and closed to unapproved fields', () => {
    expect(
      customerSummaryResponse.safeParse({
        all_customers: 128,
        new_this_month: 14,
        returning_customers: 42,
        upcoming_customers: 19,
        revenue: 1,
      }).success,
    ).toBe(false);
  });

  it('requires detail archive timestamps to match operational profile status', () => {
    expect({
      active: customerDetailResponse.safeParse(activeDetail).success,
      invalidArchived: customerDetailResponse.safeParse({ ...activeDetail, status: 'archived' }).success,
    }).toEqual({ active: true, invalidArchived: false });
  });

  it('keeps customer history pagination bounded and opaque', () => {
    expect(customerHistoryQuery.parse({ limit: '10', cursor: 'opaque-cursor' })).toEqual({
      limit: 10,
      cursor: 'opaque-cursor',
    });
  });

  it('uses canonical reservation state, snapshots, and minor-unit money in reservation history', () => {
    const history = {
      items: [
        {
          id: ids.reservation,
          reference_code: 'RSV-0001',
          clothing_name_snapshot: 'Emerald Filipiniana Gown',
          status: 'completed',
          pickup_at: '2026-09-21T02:00:00.000Z',
          due_at: '2026-09-24T06:00:00.000Z',
          rental_total_minor: '350000',
          currency: 'PHP',
        },
      ],
      page_meta: { next_cursor: null, has_more: false },
    };

    expect({
      valid: customerReservationHistoryResponse.safeParse(history).success,
      decimalMajorUnitsRejected: customerReservationHistoryResponse.safeParse({
        ...history,
        items: [{ ...history.items[0], rental_total_minor: '3500.00' }],
      }).success,
    }).toEqual({ valid: true, decimalMajorUnitsRejected: false });
  });

  it('keeps fitting history minimal while reusing fitting and payment status vocabularies', () => {
    expect(
      customerFittingHistoryResponse.safeParse({
        items: [
          {
            id: ids.fitting,
            starts_at: '2026-09-18T06:00:00.000Z',
            status: 'completed',
            garment_summary: 'Champagne Formal Gown · Size S',
            fee: { fee_minor: '20000', currency: 'PHP', payment_status: 'paid' },
          },
        ],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(true);
  });

  it('requires edit requests to retain a usable phone or email and expected timestamp', () => {
    const valid = {
      full_name: 'Maria Santos',
      phone: '09175550101',
      email: null,
      address: null,
      social_media: null,
      notes: null,
      expected_updated_at: updatedAt,
    };

    expect({
      valid: customerEditRequest.safeParse(valid).success,
      noContact: customerEditRequest.safeParse({ ...valid, phone: null }).success,
      missingConcurrency: customerEditRequest.safeParse({
        full_name: valid.full_name,
        phone: valid.phone,
        email: valid.email,
        address: valid.address,
        social_media: valid.social_media,
        notes: valid.notes,
      }).success,
    }).toEqual({ valid: true, noContact: false, missingConcurrency: false });
  });

  it('defines explicit archive intent and an authoritative archived response', () => {
    expect({
      request: customerArchiveRequest.safeParse({ expected_updated_at: updatedAt }).success,
      response: customerArchiveResponse.safeParse({
        id: ids.customer,
        status: 'archived',
        archived_at: '2026-09-28T02:05:00.000Z',
        updated_at: '2026-09-28T02:05:00.001Z',
      }).success,
    }).toEqual({ request: true, response: true });
  });
});
