import { isAppError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export type FittingFailureClass =
  | 'validation'
  | 'state'
  | 'capacity'
  | 'garment'
  | 'schedule'
  | 'authorization'
  | 'payment'
  | 'idempotency'
  | 'not_found'
  | 'other';

export interface FittingFailureMetric {
  operation: string;
  failure_class: FittingFailureClass;
  code: string;
  count: number;
}

const counters = new Map<string, number>();

export function recordFittingCommandFailure(input: {
  operation: string;
  tenantId?: string;
  branchId?: string;
  requestId: string;
  fittingId?: string;
  error: unknown;
}): void {
  const failureClass = classifyFittingFailure(input.error);
  const code = isAppError(input.error) ? input.error.code : 'UNEXPECTED';
  const key = `${input.operation}|${failureClass}|${code}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);

  logger.warn(
    {
      operation: input.operation,
      failureClass,
      code,
      requestId: input.requestId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.fittingId ? { fittingId: input.fittingId } : {}),
    },
    'fitting command rejected',
  );
}

export function snapshotFittingFailureMetrics(): FittingFailureMetric[] {
  return [...counters.entries()]
    .map(([key, count]) => {
      const [operation = '', failure_class = 'other', code = 'UNEXPECTED'] = key.split('|');
      return {
        operation,
        failure_class: failure_class as FittingFailureClass,
        code,
        count,
      };
    })
    .sort((a, b) =>
      `${a.operation}|${a.failure_class}|${a.code}`.localeCompare(
        `${b.operation}|${b.failure_class}|${b.code}`,
      ),
    );
}

export function resetFittingFailureMetrics(): void {
  counters.clear();
}

export function classifyFittingFailure(error: unknown): FittingFailureClass {
  if (!isAppError(error)) return 'other';
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'CAPACITY_CONFLICT':
      return 'capacity';
    case 'ASSET_UNAVAILABLE':
    case 'ASSET_UNREADY':
      return 'garment';
    case 'SCHEDULE_CONFLICT':
      return 'schedule';
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
    case 'TENANT_RESTRICTED':
    case 'TENANT_CANCELLED':
      return 'authorization';
    case 'PAYMENT_PREREQUISITE_FAILED':
      return 'payment';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'idempotency';
    case 'NOT_FOUND':
      return 'not_found';
    case 'STATE_CONFLICT':
    case 'STALE_VERSION':
    case 'INVALID_RESERVATION_TRANSITION':
      return 'state';
    default:
      return 'other';
  }
}
