import { randomUUID } from 'node:crypto';

import {
  fittingSettingsUpdateRequest,
  fittingSettingsUpdateResponse,
  type FittingSettingsUpdateRequest,
  type FittingSettingsUpdateResponse,
  type PermissionCode,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  NotFoundError,
  StaleVersionError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import {
  claimFittingCapacitySlot,
  ensureFittingCapacitySlots,
} from './fittings.command.repository.js';
import {
  appendFittingSettingsAudit,
  deactivateFittingCapacitySlotsAbove,
  lockFittingSettingsForCommand,
  lockScheduledFittingsForCapacityConfiguration,
  releaseScheduledFittingCapacityClaims,
  updateFittingSettingsScalars,
  type ScheduledFittingCapacityRow,
} from './fittings.settings.command.repository.js';
import { toFittingSettings } from './fittings.settings.mapper.js';
import { readFittingSettingsModel } from './fittings.settings.repository.js';

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface FittingConfigurationCommandContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  role: 'owner' | 'frontdesk';
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

export async function updateFittingSettingsCommand(
  context: FittingConfigurationCommandContext,
  requestInput: FittingSettingsUpdateRequest,
): Promise<CommandResult<FittingSettingsUpdateResponse>> {
  const parsed = fittingSettingsUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting settings request is invalid.');
  assertConfigurationMutationContext(context);

  return withTenantTransaction(context.tenantId, context.principalId, (client) =>
    runIdempotentCommand(
      client,
      {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation: 'fitting.settings.update',
        intentKey: context.idempotencyKey,
        requestId: context.requestId,
      },
      { branch_id: context.branchId, ...parsed.data },
      async () => {
        try {
          const request = parsed.data;
          assertPostgresBigintMoney(request.fee_minor);

          const settings = await lockFittingSettingsForCommand(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
          });
          if (!settings) throw new NotFoundError('Fitting settings could not be found.');
          if (Number(settings.version) !== request.version) {
            throw new StaleVersionError('Fitting settings version is stale.');
          }

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

          await appendFittingSettingsAudit(client, {
            tenantId: context.tenantId,
            actorKey: context.principalId,
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

          const model = await readFittingSettingsModel(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
          });
          if (!model) throw new Error('Updated fitting settings could not be read back.');
          return fittingSettingsUpdateResponse.parse({ settings: toFittingSettings(model) });
        } catch (error) {
          throw mapFittingSettingsConflict(error);
        }
      },
    ),
  );
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

function assertPostgresBigintMoney(value: string): void {
  if (BigInt(value) > POSTGRES_BIGINT_MAX) {
    throw new ValidationError('Fitting fee exceeds the supported money range.');
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

function mapFittingSettingsConflict(error: unknown): unknown {
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
