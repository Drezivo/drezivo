/* The persistence boundary is mocked to assert transaction intent without using a real database. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapacityConflictError, PaymentAlreadyPendingError } from '../../../shared/errors.js';
import {
  changeTenantPlan,
  operatorPlanRequestFingerprint,
  type OperatorPlanChangeInput,
} from '../operator-plan-change.service.js';

const doubles = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transactionQueue: Promise.resolve(),
  lockTenantSubscription: vi.fn(),
  readSubscriptionProjection: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  appendSubscriptionEvent: vi.fn(),
  assertOperatorPlanCapacity: vi.fn(),
  resolvePlanEntitlements: vi.fn(),
  resolveTenantEntitlements: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  withOperatorTenantTransaction: async <T>(
    _tenantId: string,
    _operatorSubject: string,
    callback: (client: never) => Promise<T>,
  ) => {
    const previous = doubles.transactionQueue;
    let release: () => void = () => undefined;
    doubles.transactionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback(doubles.client as never);
    } finally {
      release();
    }
  },
}));
vi.mock('../../billing/billing.repository.js', () => ({
  appendSubscriptionEvent: doubles.appendSubscriptionEvent,
  lockTenantSubscription: doubles.lockTenantSubscription,
  readSubscriptionProjection: doubles.readSubscriptionProjection,
  updateSubscriptionPlan: doubles.updateSubscriptionPlan,
}));
vi.mock('../../entitlements/entitlements.service.js', () => ({
  assertOperatorPlanCapacity: doubles.assertOperatorPlanCapacity,
  resolvePlanEntitlements: doubles.resolvePlanEntitlements,
  resolveTenantEntitlements: doubles.resolveTenantEntitlements,
}));

const tenantId = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-10-31T00:00:00.000Z');
const subscription = {
  tenant_id: tenantId,
  tenant_status: 'active',
  subscription_id: '00000000-0000-4000-8000-000000000003',
  plan_id: 'plan-starter',
  status: 'trialing',
  trial_ends_at: new Date('2026-11-01T00:00:00.000Z'),
  current_period_start: now,
  current_period_end: now,
  grace_ends_at: null,
};

function command(planCode: OperatorPlanChangeInput['planCode']): OperatorPlanChangeInput {
  return {
    tenantId,
    planCode,
    reason: null,
    operatorSubject: 'operator-1',
    idempotencyKey: 'operator-plan-request-0001',
    requestId: 'request-1',
  };
}

describe('operator plan change transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.transactionQueue = Promise.resolve();
    doubles.lockTenantSubscription.mockResolvedValue(subscription);
    doubles.readSubscriptionProjection.mockResolvedValue({ id: subscription.subscription_id, plan_code: 'scale', status: 'trialing', trial_ends_at: subscription.trial_ends_at, grace_ends_at: null });
    doubles.updateSubscriptionPlan.mockResolvedValue(true);
    doubles.appendSubscriptionEvent.mockResolvedValue(undefined);
    doubles.assertOperatorPlanCapacity.mockResolvedValue(undefined);
    doubles.resolveTenantEntitlements.mockResolvedValue({ planId: 'plan-starter', planCode: 'starter' });
    doubles.resolvePlanEntitlements.mockImplementation((_client: unknown, planCode: string) => ({ planId: `plan-${planCode}`, planCode }));
    doubles.client.query.mockImplementation((statement: string) => {
      if (statement.includes('SELECT id, resource_id, request_fingerprint')) return { rows: [] };
      if (statement.includes('SELECT statement_timestamp()')) return { rows: [{ now }] };
      if (statement.includes('SELECT EXISTS')) return { rows: [{ pending: false }] };
      if (statement.includes('INSERT INTO operator_command')) return { rows: [{ id: '00000000-0000-4000-8000-000000000004' }] };
      return { rows: [] };
    });
  });

  it.each(['starter', 'standard', 'growth', 'scale'] as const)(
    'applies the catalog and capacity rules for %s and stores an omitted reason as NULL',
    async (planCode) => {
      const result = await changeTenantPlan(command(planCode));
      const commandInsert = doubles.client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO operator_command'));
      const auditInsert = doubles.client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_event'));

      expect(result).toMatchObject({ tenant_id: tenantId, plan_code: planCode, replayed: false });
      expect(doubles.resolvePlanEntitlements).toHaveBeenCalledWith(doubles.client, planCode);
      expect(doubles.assertOperatorPlanCapacity).toHaveBeenCalledTimes(planCode === 'starter' ? 0 : 1);
      expect(doubles.updateSubscriptionPlan).toHaveBeenCalledTimes(planCode === 'starter' ? 0 : 1);
      expect(commandInsert?.[1]).toContain(null);
      expect(auditInsert?.[0]).toContain("'operator', $2");
      expect(auditInsert?.[0]).toContain("'subscription.plan_changed'");
    },
  );

  it('changes a paid plan without modifying its billing period', async () => {
    const currentPeriodEnd = new Date('2026-11-30T00:00:00.000Z');
    doubles.lockTenantSubscription.mockResolvedValue({ ...subscription, status: 'active', current_period_end: currentPeriodEnd });

    await expect(changeTenantPlan(command('growth'))).resolves.toMatchObject({ plan_code: 'growth', changed: true });
    expect(doubles.updateSubscriptionPlan).toHaveBeenCalledWith(doubles.client, {
      tenantId, subscriptionId: subscription.subscription_id, planId: 'plan-growth',
    });
    expect(doubles.appendSubscriptionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not upgrade a Free subscription through the operator command', async () => {
    doubles.lockTenantSubscription.mockResolvedValue({ ...subscription, status: 'active', current_period_end: new Date('2026-11-30T00:00:00.000Z') });
    doubles.resolveTenantEntitlements.mockResolvedValue({ planId: 'plan-starter', planCode: 'free' });
    await expect(changeTenantPlan(command('growth'))).rejects.toThrow('non-cancelled paid subscription');
    expect(doubles.updateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('blocks a pending payment before changing the subscription', async () => {
    doubles.client.query.mockImplementation((statement: string) => {
      if (statement.includes('SELECT id, resource_id, request_fingerprint')) return { rows: [] };
      if (statement.includes('SELECT statement_timestamp()')) return { rows: [{ now }] };
      if (statement.includes('SELECT EXISTS')) return { rows: [{ pending: true }] };
      return { rows: [] };
    });

    await expect(changeTenantPlan(command('growth'))).rejects.toBeInstanceOf(PaymentAlreadyPendingError);
    expect(doubles.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(doubles.client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO operator_command'), expect.anything());
  });

  it('does not write a plan when capacity does not fit the selected tier', async () => {
    doubles.assertOperatorPlanCapacity.mockRejectedValue(new CapacityConflictError('The workspace plan limit would be exceeded.'));

    await expect(changeTenantPlan(command('scale'))).rejects.toBeInstanceOf(CapacityConflictError);
    expect(doubles.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(doubles.appendSubscriptionEvent).not.toHaveBeenCalled();
  });

  it('replays a completed identical request without repeating billing or audit writes', async () => {
    const input = command('scale');
    const fingerprint = operatorPlanRequestFingerprint(input);
    doubles.client.query.mockImplementation((statement: string) => {
      if (statement.includes('SELECT id, resource_id, request_fingerprint')) {
        return { rows: [{ id: 'command-1', resource_id: tenantId, request_fingerprint: fingerprint, status: 'completed' }] };
      }
      return { rows: [] };
    });

    await expect(changeTenantPlan(input)).resolves.toMatchObject({ plan_code: 'scale', changed: false, replayed: true });
    expect(doubles.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(doubles.assertOperatorPlanCapacity).not.toHaveBeenCalled();
    expect(doubles.client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_event'), expect.anything());
  });

  it('serializes concurrent identical commands so only one plan event and audit write win', async () => {
    const input = command('scale');
    const fingerprint = operatorPlanRequestFingerprint(input);
    let commandRecorded = false;
    doubles.client.query.mockImplementation((statement: string) => {
      if (statement.includes('SELECT id, resource_id, request_fingerprint')) {
        return {
          rows: commandRecorded
            ? [{ id: 'command-1', resource_id: tenantId, request_fingerprint: fingerprint, status: 'completed' }]
            : [],
        };
      }
      if (statement.includes('SELECT statement_timestamp()')) return { rows: [{ now }] };
      if (statement.includes('SELECT EXISTS')) return { rows: [{ pending: false }] };
      if (statement.includes('INSERT INTO operator_command')) {
        commandRecorded = true;
        return { rows: [{ id: '00000000-0000-4000-8000-000000000004' }] };
      }
      return { rows: [] };
    });

    const results = await Promise.all([changeTenantPlan(input), changeTenantPlan(input)]);

    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(doubles.updateSubscriptionPlan).toHaveBeenCalledTimes(1);
    expect(doubles.appendSubscriptionEvent).toHaveBeenCalledTimes(1);
    expect(doubles.client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO audit_event'))).toHaveLength(1);
  });

  it('rejects the same idempotency key when the selected plan changes', async () => {
    const prior = command('growth');
    const fingerprint = operatorPlanRequestFingerprint(prior);
    doubles.client.query.mockImplementation((statement: string) => {
      if (statement.includes('SELECT id, resource_id, request_fingerprint')) {
        return { rows: [{ id: 'command-1', resource_id: tenantId, request_fingerprint: fingerprint, status: 'completed' }] };
      }
      return { rows: [] };
    });

    await expect(changeTenantPlan(command('scale'))).rejects.toThrow('already used');
    expect(doubles.updateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('rejects Free even if called without the HTTP request schema', async () => {
    await expect(changeTenantPlan({ ...command('starter'), planCode: 'free' as 'starter' }))
      .rejects.toThrow('Choose an active paid plan.');
  });
});
