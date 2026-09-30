import { describe, expect, it } from 'vitest';

import {
  branchBusinessHours,
  branchClosureCreateRequest,
  branchClosureListQuery,
  branchClosureRemoveRequest,
  branchClosureUpdateRequest,
  branchOperatingHours,
  updateBranchBusinessHoursRequest,
} from '../src';

const branchId = '00000000-0000-4000-8000-000000000201';

describe('branch business hours contracts', () => {
  it('accepts one shared opening/closing window with recurring closed weekdays', () => {
    expect(
      branchOperatingHours.safeParse({
        opens_local: '09:00',
        closes_local: '20:00',
        closed_weekdays: ['sunday'],
      }).success,
    ).toBe(true);
  });

  it('rejects equal, reversed, and malformed local times', () => {
    const results = [
      branchOperatingHours.safeParse({
        opens_local: '09:00',
        closes_local: '09:00',
        closed_weekdays: [],
      }).success,
      branchOperatingHours.safeParse({
        opens_local: '20:00',
        closes_local: '09:00',
        closed_weekdays: [],
      }).success,
      branchOperatingHours.safeParse({
        opens_local: '9:00',
        closes_local: '20:00',
        closed_weekdays: [],
      }).success,
    ];

    expect(results).toEqual([false, false, false]);
  });

  it('rejects duplicate recurring closed weekdays', () => {
    expect(
      branchOperatingHours.safeParse({
        opens_local: '09:00',
        closes_local: '20:00',
        closed_weekdays: ['sunday', 'sunday'],
      }).success,
    ).toBe(false);
  });

  it('returns active-branch identity, timezone, version, and update time with business hours', () => {
    expect(
      branchBusinessHours.safeParse({
        branch_id: branchId,
        opens_local: '09:00',
        closes_local: '20:00',
        closed_weekdays: ['sunday'],
        timezone: 'Asia/Manila',
        version: 3,
        updated_at: '2026-09-30T15:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('requires optimistic versioning and rejects client-owned branch identity on updates', () => {
    const results = [
      updateBranchBusinessHoursRequest.safeParse({
        version: 3,
        opens_local: '09:00',
        closes_local: '20:00',
        closed_weekdays: ['sunday'],
      }).success,
      updateBranchBusinessHoursRequest.safeParse({
        version: 3,
        branch_id: branchId,
        opens_local: '09:00',
        closes_local: '20:00',
        closed_weekdays: ['sunday'],
      }).success,
    ];

    expect(results).toEqual([true, false]);
  });

  it('bounds special closed-date list windows to one year', () => {
    const results = [
      branchClosureListQuery.safeParse({
        date_start: '2026-01-01',
        date_end: '2026-12-31',
      }).success,
      branchClosureListQuery.safeParse({
        date_start: '2026-12-31',
        date_end: '2026-01-01',
      }).success,
      branchClosureListQuery.safeParse({
        date_start: '2026-01-01',
        date_end: '2028-01-01',
      }).success,
      branchClosureListQuery.safeParse({
        date_start: '2026-02-30',
        date_end: '2026-03-01',
      }).success,
    ];

    expect(results).toEqual([true, false, false, false]);
  });

  it('validates branch closed-date create, update, and remove payloads', () => {
    const results = [
      branchClosureCreateRequest.safeParse({
        local_date: '2026-12-25',
        reason: 'Christmas Day',
      }).success,
      branchClosureUpdateRequest.safeParse({
        version: 2,
        local_date: '2026-12-26',
        reason: 'Holiday closure',
      }).success,
      branchClosureRemoveRequest.safeParse({ version: 2 }).success,
      branchClosureCreateRequest.safeParse({
        local_date: '2026-12-25',
        reason: '',
      }).success,
      branchClosureUpdateRequest.safeParse({
        version: 0,
        local_date: '2026-12-25',
        reason: 'Holiday closure',
      }).success,
    ];

    expect(results).toEqual([true, true, true, false, false]);
  });
});
