import { beforeEach, describe, expect, it } from 'vitest';

import {
  AssetUnavailableError,
  CapacityConflictError,
  ForbiddenError,
  ScheduleConflictError,
  StateConflictError,
  ValidationError,
} from '../../../shared/errors.js';
import {
  classifyFittingFailure,
  recordFittingCommandFailure,
  resetFittingFailureMetrics,
  snapshotFittingFailureMetrics,
} from '../fittings.observability.js';

describe('fitting safe observability', () => {
  beforeEach(() => resetFittingFailureMetrics());

  it('classifies operational failures without inspecting request/customer payloads', () => {
    expect(classifyFittingFailure(new ValidationError('invalid'))).toBe('validation');
    expect(classifyFittingFailure(new StateConflictError('stale'))).toBe('state');
    expect(classifyFittingFailure(new CapacityConflictError('full'))).toBe('capacity');
    expect(classifyFittingFailure(new AssetUnavailableError('taken'))).toBe('garment');
    expect(classifyFittingFailure(new ScheduleConflictError('closed'))).toBe('schedule');
    expect(classifyFittingFailure(new ForbiddenError('denied'))).toBe('authorization');
  });

  it('counts failures by operation, class, and safe error code', () => {
    const base = {
      operation: 'fitting.create.staff',
      tenantId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      requestId: 'req-safe',
    };
    recordFittingCommandFailure({ ...base, error: new CapacityConflictError('full') });
    recordFittingCommandFailure({ ...base, error: new CapacityConflictError('full') });
    recordFittingCommandFailure({ ...base, error: new AssetUnavailableError('taken') });

    expect(snapshotFittingFailureMetrics()).toEqual([
      {
        operation: 'fitting.create.staff',
        failure_class: 'capacity',
        code: 'CAPACITY_CONFLICT',
        count: 2,
      },
      {
        operation: 'fitting.create.staff',
        failure_class: 'garment',
        code: 'ASSET_UNAVAILABLE',
        count: 1,
      },
    ]);
  });
});
