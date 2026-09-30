import { randomUUID } from 'node:crypto';

import {
  fittingClosureCreateRequest,
  fittingClosureMutationResponse,
  fittingClosureRemoveRequest,
  fittingClosureRemoveResponse,
  fittingClosureUpdateRequest,
  fittingSettingsUpdateRequest,
  fittingSettingsUpdateResponse,
  fittingWeeklyHoursUpdateRequest,
  fittingWeeklyHoursUpdateResponse,
  type FittingClosureCreateRequest,
  type FittingClosureMutationResponse,
  type FittingClosureRemoveRequest,
  type FittingClosureRemoveResponse,
  type FittingClosureUpdateRequest,
  type FittingSettingsUpdateRequest,
  type FittingSettingsUpdateResponse,
  type FittingWeeklyHours,
  type FittingWeeklyHoursUpdateRequest,
  type FittingWeeklyHoursUpdateResponse,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  ScheduleConflictError,
  StaleVersionError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  type TenantIdempotencyClaim,
} from '../../shared/tenant-idempotency.js';
import {
  claimFittingCapacitySlot,
  ensureFittingCapacitySlots,
} from './fittings.command.repository.js';
import {
  appendFittingClosureAudit,
  appendFittingConfigurationAudit,
  bumpFittingSettingsVersion,
  createFittingClosure,
  deactivateFittingCapacitySlotsAbove,
  lockFittingClosureForCommand,
  lockFittingSettingsForCommand,
  lockFutureFittingsForScheduleConfiguration,
  lockScheduledFittingsForCapacityConfiguration,
  proposedClosureInvalidatesFutureFittings,
  proposedWeeklyHoursInvalidateFutureFittings,
  releaseScheduledFittingCapacityClaims,
  removeFittingClosure,
  replaceFittingWeeklyHours,
  updateFittingClosure,
  updateFittingSettingsScalars,
  type FittingWeeklyWindowRow,
  type ScheduledFittingCapacityRow,
} from './fittings.schedule.command.repository.js';
import { recordFittingCommandFailure } from './fittings.observability.js';
import {
  toFittingClosure,
  toFittingSettings,
  toLegacyFittingScheduleSettings,
} from './fittings.schedule.mapper.js';
import { readFittingSettingsModel } from './fittings.schedule.repository.js';

const SETTINGS_UPDATE_OPERATION = 'fitting.settings.update';
const HOURS_REPLACE_OPERATION = 'fitting.hours.replace';
const CLOSURE_CREATE_OPERATION = 'fitting.closure.create';
const CLOSURE_UPDATE_OPERATION = 'fitting.closure.update';
const CLOSURE_REMOVE_OPERATION = 'fitting.closure.remove';
const CONFIGURATION_SAVEPOINT = 'fitting_configuration_effects';
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface FittingConfigurationCommandContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  role: 'owner' | 'frontdesk';
  effectiveTenantStatus: TenantStatus;
}

export interface FittingSettingsCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingSettingsUpdateResponse> | FailureEnvelope;
}

export interface FittingWeeklyHoursCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingWeeklyHoursUpdateResponse> | FailureEnvelope;
}

export interface FittingClosureMutationCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingClosureMutationResponse> | FailureEnvelope;
}

export interface FittingClosureRemoveCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingClosureRemoveResponse> | FailureEnvelope;
}

export interface FittingClosureCommandContext extends FittingConfigurationCommandContext {
  closureId: string;
}

export async function updateFittingWeeklyHoursCommand(
  context: FittingConfigurationCommandContext,
  requestInput: FittingWeeklyHoursUpdateRequest,
): Promise<FittingWeeklyHoursCommandResponse> {
  const parsed = fittingWeeklyHoursUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Weekly fitting-hours request is invalid.');
  assertConfigurationMutationContext(context);

  const request = parsed.data;
  const windows = normalizeWeeklyHours(request.weekly_hours);
  assertLegacyScheduleRepresentable(windows);
  const payloadHash = canonicalRequestHash({ branch_id: context.branchId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimConfigurationIdempotency(
      client,
      context,
      HOURS_REPLACE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingWeeklyHoursCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const settings = await lockFittingSettingsForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings) throw new NotFoundError('Fitting settings could not be found.');
      assertCurrentSettingsVersion(settings.version, request.version);

      await lockFutureFittingsForScheduleConfiguration(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (
        await proposedWeeklyHoursInvalidateFutureFittings(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          windows,
        })
      ) {
        throw new ScheduleConflictError(
          'Weekly fitting hours cannot invalidate an accepted future fitting.',
        );
      }

      await client.query(`SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = true;
      await replaceFittingWeeklyHours(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        windows,
      });
      const version = await bumpFittingSettingsVersion(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        version: request.version,
      });
      if (!version) throw new StaleVersionError('Fitting settings version is stale.');

      await appendFittingConfigurationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.hours_updated',
        branchId: context.branchId,
        requestId: context.requestId,
        version,
        summary: { configured_windows: windows.length },
      });

      const body = await buildWeeklyHoursSuccess(client, context);
      await finalizeConfigurationSuccess(
        client,
        context,
        HOURS_REPLACE_OPERATION,
        payloadHash,
        body,
      );
      await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      }
      return finalizeConfigurationFailure(
        client,
        context,
        HOURS_REPLACE_OPERATION,
        payloadHash,
        mapConfigurationConflict(error),
      );
    }
  });
}

export async function createFittingClosureCommand(
  context: FittingConfigurationCommandContext,
  requestInput: FittingClosureCreateRequest,
): Promise<FittingClosureMutationCommandResponse> {
  const parsed = fittingClosureCreateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting closure request is invalid.');
  assertConfigurationMutationContext(context);

  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ branch_id: context.branchId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimConfigurationIdempotency(
      client,
      context,
      CLOSURE_CREATE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingClosureMutationCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const settings = await lockFittingSettingsForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings) throw new NotFoundError('Fitting settings could not be found.');
      assertCurrentSettingsVersion(settings.version, request.settings_version);

      await lockFutureFittingsForScheduleConfiguration(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (
        await proposedClosureInvalidatesFutureFittings(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          startsAt: request.period.start,
          endsAt: request.period.end,
        })
      ) {
        throw new ScheduleConflictError(
          'Fitting closure cannot invalidate an accepted future fitting.',
        );
      }

      await client.query(`SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = true;
      const closure = await createFittingClosure(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        startsAt: request.period.start,
        endsAt: request.period.end,
        timezone: settings.timezone,
        reason: request.reason,
      });
      const version = await bumpFittingSettingsVersion(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        version: request.settings_version,
      });
      if (!version) throw new StaleVersionError('Fitting settings version is stale.');

      await appendFittingClosureAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.closure_created',
        branchId: context.branchId,
        closureId: closure.id,
        requestId: context.requestId,
        version,
        summary: {
          period_start: closure.starts_at.toISOString(),
          period_end: closure.ends_at.toISOString(),
          timezone_snapshot: closure.timezone_snapshot,
        },
      });

      const body: SuccessEnvelope<FittingClosureMutationResponse> = {
        success: true,
        data: fittingClosureMutationResponse.parse({
          closure: toFittingClosure(closure),
          settings_version: version,
        }),
        request_id: context.requestId,
      };
      await finalizeConfigurationSuccess(
        client,
        context,
        CLOSURE_CREATE_OPERATION,
        payloadHash,
        body,
        201,
      );
      await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 201, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      }
      return finalizeConfigurationFailure(
        client,
        context,
        CLOSURE_CREATE_OPERATION,
        payloadHash,
        mapConfigurationConflict(error),
      );
    }
  });
}

export async function updateFittingClosureCommand(
  context: FittingClosureCommandContext,
  requestInput: FittingClosureUpdateRequest,
): Promise<FittingClosureMutationCommandResponse> {
  const parsed = fittingClosureUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting closure request is invalid.');
  assertConfigurationMutationContext(context);

  const request = parsed.data;
  const payloadHash = canonicalRequestHash({
    branch_id: context.branchId,
    closure_id: context.closureId,
    ...request,
  });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimConfigurationIdempotency(
      client,
      context,
      CLOSURE_UPDATE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingClosureMutationCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const settings = await lockFittingSettingsForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings) throw new NotFoundError('Fitting settings could not be found.');
      assertCurrentSettingsVersion(settings.version, request.settings_version);

      const existing = await lockFittingClosureForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        closureId: context.closureId,
      });
      if (!existing) throw new NotFoundError('Fitting closure could not be found.');

      await lockFutureFittingsForScheduleConfiguration(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (
        await proposedClosureInvalidatesFutureFittings(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          startsAt: request.period.start,
          endsAt: request.period.end,
        })
      ) {
        throw new ScheduleConflictError(
          'Fitting closure cannot invalidate an accepted future fitting.',
        );
      }

      await client.query(`SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = true;
      const closure = await updateFittingClosure(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        closureId: context.closureId,
        startsAt: request.period.start,
        endsAt: request.period.end,
        timezone: settings.timezone,
        reason: request.reason,
      });
      if (!closure) throw new NotFoundError('Fitting closure could not be found.');
      const version = await bumpFittingSettingsVersion(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        version: request.settings_version,
      });
      if (!version) throw new StaleVersionError('Fitting settings version is stale.');

      await appendFittingClosureAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.closure_updated',
        branchId: context.branchId,
        closureId: closure.id,
        requestId: context.requestId,
        version,
        summary: {
          period_start: closure.starts_at.toISOString(),
          period_end: closure.ends_at.toISOString(),
          timezone_snapshot: closure.timezone_snapshot,
        },
      });

      const body: SuccessEnvelope<FittingClosureMutationResponse> = {
        success: true,
        data: fittingClosureMutationResponse.parse({
          closure: toFittingClosure(closure),
          settings_version: version,
        }),
        request_id: context.requestId,
      };
      await finalizeConfigurationSuccess(
        client,
        context,
        CLOSURE_UPDATE_OPERATION,
        payloadHash,
        body,
      );
      await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      }
      return finalizeConfigurationFailure(
        client,
        context,
        CLOSURE_UPDATE_OPERATION,
        payloadHash,
        mapConfigurationConflict(error),
      );
    }
  });
}

export async function removeFittingClosureCommand(
  context: FittingClosureCommandContext,
  requestInput: FittingClosureRemoveRequest,
): Promise<FittingClosureRemoveCommandResponse> {
  const parsed = fittingClosureRemoveRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting closure remove request is invalid.');
  assertConfigurationMutationContext(context);

  const request = parsed.data;
  const payloadHash = canonicalRequestHash({
    branch_id: context.branchId,
    closure_id: context.closureId,
    ...request,
  });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimConfigurationIdempotency(
      client,
      context,
      CLOSURE_REMOVE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingClosureRemoveCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const settings = await lockFittingSettingsForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings) throw new NotFoundError('Fitting settings could not be found.');
      assertCurrentSettingsVersion(settings.version, request.settings_version);

      const existing = await lockFittingClosureForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        closureId: context.closureId,
      });
      if (!existing) throw new NotFoundError('Fitting closure could not be found.');

      await client.query(`SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = true;
      const removed = await removeFittingClosure(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        closureId: context.closureId,
      });
      if (!removed) throw new NotFoundError('Fitting closure could not be found.');
      const version = await bumpFittingSettingsVersion(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        version: request.settings_version,
      });
      if (!version) throw new StaleVersionError('Fitting settings version is stale.');

      await appendFittingClosureAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.closure_removed',
        branchId: context.branchId,
        closureId: context.closureId,
        requestId: context.requestId,
        version,
        summary: {},
      });

      const body: SuccessEnvelope<FittingClosureRemoveResponse> = {
        success: true,
        data: fittingClosureRemoveResponse.parse({
          closure_id: context.closureId,
          settings_version: version,
        }),
        request_id: context.requestId,
      };
      await finalizeConfigurationSuccess(
        client,
        context,
        CLOSURE_REMOVE_OPERATION,
        payloadHash,
        body,
      );
      await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      }
      return finalizeConfigurationFailure(
        client,
        context,
        CLOSURE_REMOVE_OPERATION,
        payloadHash,
        mapConfigurationConflict(error),
      );
    }
  });
}

export async function updateFittingSettingsCommand(
  context: FittingConfigurationCommandContext,
  requestInput: FittingSettingsUpdateRequest,
): Promise<FittingSettingsCommandResponse> {
  const parsed = fittingSettingsUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting settings request is invalid.');
  assertConfigurationMutationContext(context);

  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ branch_id: context.branchId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimConfigurationIdempotency(
      client,
      context,
      SETTINGS_UPDATE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingSettingsCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      assertPostgresBigintMoney(request.fee_minor);
      const settings = await lockFittingSettingsForCommand(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings) throw new NotFoundError('Fitting settings could not be found.');
      assertCurrentSettingsVersion(settings.version, request.version);

      let scheduled: ScheduledFittingCapacityRow[] = [];
      if (request.capacity < settings.capacity) {
        scheduled = await lockScheduledFittingsForCapacityConfiguration(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
        });
        if (maximumSimultaneousFittings(scheduled) > request.capacity) {
          throw new StateConflictError(
            'Fitting capacity cannot be reduced below accepted scheduled demand.',
          );
        }
      }

      await client.query(`SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = true;

      if (request.capacity < settings.capacity) {
        const fittingIds = scheduled.map((appointment) => appointment.id);
        const released = await releaseScheduledFittingCapacityClaims(client, {
          tenantId: context.tenantId,
          fittingIds,
        });
        if (released !== fittingIds.length) {
          throw new StateConflictError(
            'Scheduled fitting capacity claims are incomplete and cannot be safely rebalanced.',
          );
        }

        await ensureFittingCapacitySlots(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          capacity: request.capacity,
        });
        await deactivateFittingCapacitySlotsAbove(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          capacity: request.capacity,
        });

        for (const appointment of scheduled) {
          const slotId = await claimFittingCapacitySlot(client, {
            allocationId: randomUUID(),
            tenantId: context.tenantId,
            branchId: context.branchId,
            fittingId: appointment.id,
            startsAt: appointment.starts_at.toISOString(),
            endsAt: appointment.ends_at.toISOString(),
          });
          if (!slotId) {
            throw new StateConflictError(
              'Accepted fittings could not be safely rebalanced within the reduced capacity.',
            );
          }
        }
      } else if (request.capacity > settings.capacity) {
        await ensureFittingCapacitySlots(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          capacity: request.capacity,
        });
      }

      const version = await updateFittingSettingsScalars(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        version: request.version,
        enabled: request.enabled,
        capacity: request.capacity,
        durationMinutes: request.duration_minutes,
        feeMinor: request.fee_minor,
      });
      if (!version) throw new StaleVersionError('Fitting settings version is stale.');

      await appendFittingConfigurationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.settings_updated',
        branchId: context.branchId,
        requestId: context.requestId,
        version,
        summary: {
          enabled: request.enabled,
          capacity: request.capacity,
          duration_minutes: request.duration_minutes,
          fee_minor: request.fee_minor,
        },
      });

      const body = await buildSettingsSuccess(client, context);
      await finalizeConfigurationSuccess(
        client,
        context,
        SETTINGS_UPDATE_OPERATION,
        payloadHash,
        body,
      );
      await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CONFIGURATION_SAVEPOINT}`);
      }
      return finalizeConfigurationFailure(
        client,
        context,
        SETTINGS_UPDATE_OPERATION,
        payloadHash,
        mapConfigurationConflict(error),
      );
    }
  });
}

function assertConfigurationMutationContext(context: FittingConfigurationCommandContext): void {
  if (context.effectiveTenantStatus === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  if (context.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only Owner may mutate fitting configuration.');
  }
}

function assertCurrentSettingsVersion(actual: string | number, requested: number): void {
  if (Number(actual) !== requested) {
    throw new StaleVersionError('Fitting settings version is stale.');
  }
}

function assertPostgresBigintMoney(value: string): void {
  if (BigInt(value) > POSTGRES_BIGINT_MAX) {
    throw new ValidationError('Fitting fee exceeds the supported money range.');
  }
}

function normalizeWeeklyHours(weeklyHours: FittingWeeklyHours): FittingWeeklyWindowRow[] {
  const weekdayNumbers = new Map<FittingWeeklyHours[number]['weekday'], number>([
    ['monday', 1],
    ['tuesday', 2],
    ['wednesday', 3],
    ['thursday', 4],
    ['friday', 5],
    ['saturday', 6],
    ['sunday', 7],
  ]);

  return [...weeklyHours]
    .sort(
      (left, right) =>
        (weekdayNumbers.get(left.weekday) ?? 0) - (weekdayNumbers.get(right.weekday) ?? 0),
    )
    .flatMap((day) => {
      const weekday = weekdayNumbers.get(day.weekday);
      if (!weekday) throw new ValidationError('Weekly fitting weekday is invalid.');
      return [...day.windows]
        .sort((left, right) => left.starts_local.localeCompare(right.starts_local))
        .map((window) => ({
          weekday,
          starts_local: window.starts_local,
          ends_local: window.ends_local,
        }));
    });
}

function assertLegacyScheduleRepresentable(windows: FittingWeeklyWindowRow[]): void {
  const weekdays = new Set<number>();
  let sharedWindow: { starts_local: string; ends_local: string } | null = null;
  for (const window of windows) {
    if (weekdays.has(window.weekday)) {
      throw new ValidationError(
        'Business Hours support one opening and closing window per open weekday.',
      );
    }
    weekdays.add(window.weekday);
    sharedWindow ??= window;
    if (
      sharedWindow.starts_local !== window.starts_local ||
      sharedWindow.ends_local !== window.ends_local
    ) {
      throw new ValidationError(
        'Business Hours use the same opening and closing time on every open weekday.',
      );
    }
  }
}

function maximumSimultaneousFittings(rows: ScheduledFittingCapacityRow[]): number {
  const events = rows.flatMap((row) => [
    { time: row.starts_at.getTime(), delta: 1 },
    { time: row.ends_at.getTime(), delta: -1 },
  ]);
  events.sort((left, right) => left.time - right.time || left.delta - right.delta);

  let concurrent = 0;
  let maximum = 0;
  for (const event of events) {
    concurrent += event.delta;
    maximum = Math.max(maximum, concurrent);
  }
  return maximum;
}

async function buildSettingsSuccess(
  client: Parameters<typeof readFittingSettingsModel>[0],
  context: FittingConfigurationCommandContext,
): Promise<SuccessEnvelope<FittingSettingsUpdateResponse>> {
  const model = await readFittingSettingsModel(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
  });
  if (!model) throw new Error('Updated fitting settings could not be read back.');
  return {
    success: true,
    data: fittingSettingsUpdateResponse.parse({ settings: toFittingSettings(model) }),
    request_id: context.requestId,
  };
}

async function buildWeeklyHoursSuccess(
  client: Parameters<typeof readFittingSettingsModel>[0],
  context: FittingConfigurationCommandContext,
): Promise<SuccessEnvelope<FittingWeeklyHoursUpdateResponse>> {
  const model = await readFittingSettingsModel(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
  });
  if (!model) throw new Error('Updated fitting settings could not be read back.');
  return {
    success: true,
    data: fittingWeeklyHoursUpdateResponse.parse({
      settings: toLegacyFittingScheduleSettings(model),
    }),
    request_id: context.requestId,
  };
}

async function claimConfigurationIdempotency(
  client: Parameters<typeof claimTenantIdempotency>[0],
  context: FittingConfigurationCommandContext,
  operation: string,
  payloadHash: string,
): Promise<TenantIdempotencyClaim> {
  return claimTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
  });
}

function replayOrThrow<T extends { status: number; body: unknown }>(
  claim: TenantIdempotencyClaim,
): T | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse } as T;
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError(
      'An identical fitting configuration request is already being processed. Retry shortly.',
    );
  }
  return null;
}

async function finalizeConfigurationSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingConfigurationCommandContext,
  operation: string,
  payloadHash: string,
  body: unknown,
  responseCode = 200,
): Promise<void> {
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode,
    safeResponse: body,
  });
}

async function finalizeConfigurationFailure<T extends { status: number; body: unknown }>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingConfigurationCommandContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<T> {
  if (!isAppError(error)) throw error;
  recordFittingCommandFailure({
    operation,
    tenantId: context.tenantId,
    branchId: context.branchId,
    requestId: context.requestId,
    error,
  });
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body } as T;
}

function mapConfigurationConflict(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === '23P01' ||
      (error as { code?: unknown }).code === '23514')
  ) {
    return new StateConflictError('Fitting configuration conflicts with accepted appointments.');
  }
  return error;
}
