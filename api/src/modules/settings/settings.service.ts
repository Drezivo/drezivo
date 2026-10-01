import type { PoolClient } from 'pg';

import {
  branchBusinessHours,
  branchClosure,
  branchClosureListResponse,
  branchClosureMutationResponse,
  branchClosureRemoveResponse,
  businessSettings,
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationSettings,
  type BranchBusinessHours,
  type BranchClosure,
  type BranchClosureCreateRequest,
  type BranchClosureListQuery,
  type BranchClosureListResponse,
  type BranchClosureMutationResponse,
  type BranchClosureRemoveRequest,
  type BranchClosureRemoveResponse,
  type BranchClosureUpdateRequest,
  type BusinessSettings,
  type NotificationPreferences,
  type NotificationSettings,
  type UpdateBranchBusinessHoursRequest,
  type UpdateBusinessSettingsRequest,
  type UpdateNotificationSettingsRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { StaffContext } from '../../middleware/staff-command.js';
import {
  ForbiddenError,
  NotFoundError,
  ScheduleConflictError,
  StaleVersionError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import {
  appendStorefrontAudit,
  readStorefront,
  syncStorefrontContactFromBusinessInformation,
} from '../storefront-cms/storefront-cms.repository.js';
import {
  appendBranchSettingsAudit,
  appendSettingsAudit,
  createBranchClosure,
  listBranchClosures,
  lockBranchClosure,
  lockFittingScheduleGate,
  proposedBranchClosureInvalidatesFutureFittings,
  proposedBusinessHoursInvalidateFutureFittings,
  readBranchBusinessHours,
  readTenantSettings,
  removeBranchClosure,
  updateBranchBusinessHours,
  updateBranchClosure,
  updateBusinessInformation,
  updateNotificationPreferences,
  type BranchBusinessHoursRow,
  type BranchClosureRow,
  type TenantSettingsRow,
} from './settings.repository.js';

/**
 * Stored preferences are read key by key over the defaults: a flag added later starts at its
 * default, and an unknown or malformed stored value can never discard the other choices.
 */
export function preferencesOf(stored: Record<string, unknown>): NotificationPreferences {
  const pick = <T extends Record<string, boolean>>(defaults: T, value: unknown): T => {
    const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const candidate = source[key as string];
      if (typeof candidate === 'boolean') result[key] = candidate as T[keyof T];
    }
    return result;
  };
  const enabled = stored['email_enabled'];
  return {
    email_enabled:
      typeof enabled === 'boolean' ? enabled : DEFAULT_NOTIFICATION_PREFERENCES.email_enabled,
    customer: pick(DEFAULT_NOTIFICATION_PREFERENCES.customer, stored['customer']),
    business: pick(DEFAULT_NOTIFICATION_PREFERENCES.business, stored['business']),
  };
}

/** Business information, Business Hours and notification settings. Owner-only writes. */
export class SettingsService {
  getBusiness(context: StaffContext): Promise<BusinessSettings> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) =>
      toBusinessSettings(await this.requireTenantRow(client, context.tenantId, false)),
    );
  }

  getBusinessHours(context: StaffContext): Promise<BranchBusinessHours> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) =>
      toBranchBusinessHours(await this.requireBranchHoursRow(client, context, false)),
    );
  }

  listBranchClosures(
    context: StaffContext,
    query: BranchClosureListQuery,
  ): Promise<BranchClosureListResponse> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const page = await listBranchClosures(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        query,
      });
      return branchClosureListResponse.parse({
        items: page.rows.map(toBranchClosure),
        page_meta: { next_cursor: page.nextCursor, has_more: page.hasMore },
      });
    });
  }

  getNotifications(context: StaffContext): Promise<NotificationSettings> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) =>
      toNotificationSettings(await this.requireTenantRow(client, context.tenantId, false)),
    );
  }

  updateBusiness(
    context: StaffContext,
    key: string,
    request: UpdateBusinessSettingsRequest,
  ): Promise<CommandResult<BusinessSettings>> {
    return this.command(context, key, 'settings.business.update', request, async (client) => {
      const { version, ...info } = request;
      // Keep lock ordering consistent with storefront writes: storefront first, tenant settings second.
      const storefront = await readStorefront(client, context.tenantId, true);
      if (!storefront) throw new NotFoundError('Storefront settings could not be found.');
      await this.requireTenantVersion(client, context.tenantId, version);
      await updateBusinessInformation(client, {
        tenantId: context.tenantId,
        expectedVersion: version,
        info,
      });
      const storefrontContactChanged = await syncStorefrontContactFromBusinessInformation(client, {
        tenantId: context.tenantId,
        storefrontId: storefront.id,
        phone: info.business_phone,
        email: info.business_email,
        address: info.business_address,
      });
      if (storefrontContactChanged) {
        await appendStorefrontAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          storefrontId: storefront.id,
          action: 'storefront.contact.synced_from_business_settings',
          summary: {
            has_email: info.business_email !== null,
            has_phone: info.business_phone !== null,
            has_address: info.business_address !== null,
          },
          requestId: context.requestId,
        });
      }
      await appendSettingsAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'settings.business.updated',
        summary: {
          has_email: info.business_email !== null,
          has_phone: info.business_phone !== null,
        },
        requestId: context.requestId,
      });
      return toBusinessSettings(await this.requireTenantRow(client, context.tenantId, false));
    });
  }

  updateBusinessHours(
    context: StaffContext,
    key: string,
    request: UpdateBranchBusinessHoursRequest,
  ): Promise<CommandResult<BranchBusinessHours>> {
    return this.command(
      context,
      key,
      'settings.business_hours.update',
      request,
      async (client) => {
        if (!(await lockFittingScheduleGate(client, { tenantId: context.tenantId, branchId: context.branchId }))) {
          throw new NotFoundError('Fitting settings could not be found for the active branch.');
        }
        const current = await this.requireBranchHoursRow(client, context, true);
        if (Number(current.version) !== request.version) {
          throw new StaleVersionError(
            'Business Hours changed since you opened them. Reload to see the latest values.',
          );
        }

        if (
          await proposedBusinessHoursInvalidateFutureFittings(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
            opensLocal: request.opens_local,
            closesLocal: request.closes_local,
            closedWeekdays: request.closed_weekdays,
          })
        ) {
          throw new ScheduleConflictError(
            'Business Hours cannot change because an accepted future fitting would fall outside the proposed open days or hours.',
          );
        }

        const updated = await updateBranchBusinessHours(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          expectedVersion: request.version,
          hours: {
            opens_local: request.opens_local,
            closes_local: request.closes_local,
            closed_weekdays: request.closed_weekdays,
          },
        });
        if (!updated) {
          throw new StaleVersionError(
            'Business Hours changed since you opened them. Reload to see the latest values.',
          );
        }

        await appendBranchSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.business_hours.updated',
          entityType: 'branch',
          entityId: context.branchId,
          branchId: context.branchId,
          summary: {
            opens_local: request.opens_local,
            closes_local: request.closes_local,
            closed_weekdays: request.closed_weekdays,
          },
          requestId: context.requestId,
        });

        return toBranchBusinessHours(await this.requireBranchHoursRow(client, context, false));
      },
    );
  }

  createBranchClosure(
    context: StaffContext,
    key: string,
    request: BranchClosureCreateRequest,
  ): Promise<CommandResult<BranchClosureMutationResponse>> {
    return this.command(
      context,
      key,
      'settings.business_hours.closure.create',
      request,
      async (client) => {
        if (!(await lockFittingScheduleGate(client, { tenantId: context.tenantId, branchId: context.branchId }))) {
          throw new NotFoundError('Fitting settings could not be found for the active branch.');
        }
        await this.requireBranchHoursRow(client, context, true);
        await this.assertClosureDoesNotInvalidateAcceptedFittings(client, context, request.local_date);

        let created: BranchClosureRow;
        try {
          created = await createBranchClosure(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
            localDate: request.local_date,
            reason: request.reason,
          });
        } catch (error) {
          throw mapBranchClosureWriteConflict(error);
        }

        await appendBranchSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.business_hours.closure.created',
          entityType: 'branch_closure',
          entityId: created.id,
          branchId: context.branchId,
          summary: { local_date: created.local_date },
          requestId: context.requestId,
        });

        return branchClosureMutationResponse.parse({ closure: toBranchClosure(created) });
      },
      201,
    );
  }

  updateBranchClosure(
    context: StaffContext,
    closureId: string,
    key: string,
    request: BranchClosureUpdateRequest,
  ): Promise<CommandResult<BranchClosureMutationResponse>> {
    return this.command(
      context,
      key,
      'settings.business_hours.closure.update',
      { closure_id: closureId, ...request },
      async (client) => {
        if (!(await lockFittingScheduleGate(client, { tenantId: context.tenantId, branchId: context.branchId }))) {
          throw new NotFoundError('Fitting settings could not be found for the active branch.');
        }
        const current = await lockBranchClosure(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          closureId,
        });
        if (!current) throw new NotFoundError('Closed date could not be found.');
        if (Number(current.version) !== request.version) {
          throw new StaleVersionError(
            'This closed date changed since you opened it. Reload to see the latest value.',
          );
        }

        if (current.local_date !== request.local_date) {
          await this.assertClosureDoesNotInvalidateAcceptedFittings(
            client,
            context,
            request.local_date,
          );
        }

        let updated: BranchClosureRow | null;
        try {
          updated = await updateBranchClosure(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
            closureId,
            expectedVersion: request.version,
            localDate: request.local_date,
            reason: request.reason,
          });
        } catch (error) {
          throw mapBranchClosureWriteConflict(error);
        }
        if (!updated) {
          throw new StaleVersionError(
            'This closed date changed since you opened it. Reload to see the latest value.',
          );
        }

        await appendBranchSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.business_hours.closure.updated',
          entityType: 'branch_closure',
          entityId: updated.id,
          branchId: context.branchId,
          summary: { local_date: updated.local_date },
          requestId: context.requestId,
        });

        return branchClosureMutationResponse.parse({ closure: toBranchClosure(updated) });
      },
    );
  }

  removeBranchClosure(
    context: StaffContext,
    closureId: string,
    key: string,
    request: BranchClosureRemoveRequest,
  ): Promise<CommandResult<BranchClosureRemoveResponse>> {
    return this.command(
      context,
      key,
      'settings.business_hours.closure.remove',
      { closure_id: closureId, ...request },
      async (client) => {
        const current = await lockBranchClosure(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          closureId,
        });
        if (!current) throw new NotFoundError('Closed date could not be found.');
        if (Number(current.version) !== request.version) {
          throw new StaleVersionError(
            'This closed date changed since you opened it. Reload to see the latest value.',
          );
        }

        const removed = await removeBranchClosure(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          closureId,
          expectedVersion: request.version,
        });
        if (!removed) {
          throw new StaleVersionError(
            'This closed date changed since you opened it. Reload to see the latest value.',
          );
        }

        await appendBranchSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.business_hours.closure.removed',
          entityType: 'branch_closure',
          entityId: current.id,
          branchId: context.branchId,
          summary: { local_date: current.local_date },
          requestId: context.requestId,
        });

        return branchClosureRemoveResponse.parse({ closure_id: current.id });
      },
    );
  }

  updateNotifications(
    context: StaffContext,
    key: string,
    request: UpdateNotificationSettingsRequest,
  ): Promise<CommandResult<NotificationSettings>> {
    return this.command(
      context,
      key,
      'settings.notifications.update',
      request,
      async (client) => {
        const { version, ...preferences } = request;
        await this.requireTenantVersion(client, context.tenantId, version);
        await updateNotificationPreferences(client, {
          tenantId: context.tenantId,
          expectedVersion: version,
          preferences,
        });
        await appendSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.notifications.updated',
          summary: { email_enabled: preferences.email_enabled },
          requestId: context.requestId,
        });
        return toNotificationSettings(
          await this.requireTenantRow(client, context.tenantId, false),
        );
      },
    );
  }

  private command<T>(
    context: StaffContext,
    key: string,
    operation: string,
    payload: unknown,
    execute: (client: PoolClient) => Promise<T>,
    successStatus = 200,
  ): Promise<CommandResult<T>> {
    if (!context.permissionCodes.includes('policies.manage')) {
      throw new ForbiddenError('Only the business owner can change business settings.');
    }
    if (context.effectiveTenantStatus === 'restricted') {
      throw new TenantRestrictedError('This workspace is temporarily restricted.');
    }
    if (context.effectiveTenantStatus === 'cancelled') {
      throw new TenantCancelledError('This workspace is closed.');
    }
    return withTenantTransaction(context.tenantId, context.principalId, (client) =>
      runIdempotentCommand(
        client,
        {
          tenantId: context.tenantId,
          principalKey: context.membershipId,
          operation,
          intentKey: key,
          requestId: context.requestId,
        },
        payload,
        () => execute(client),
        successStatus,
      ),
    );
  }

  private async requireTenantRow(
    client: PoolClient,
    tenantId: string,
    forUpdate: boolean,
  ): Promise<TenantSettingsRow> {
    const row = await readTenantSettings(client, tenantId, forUpdate);
    if (!row) throw new NotFoundError('Workspace settings could not be found.');
    return row;
  }

  private async requireBranchHoursRow(
    client: PoolClient,
    context: StaffContext,
    forUpdate: boolean,
  ): Promise<BranchBusinessHoursRow> {
    const row = await readBranchBusinessHours(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      forUpdate,
    });
    if (!row) throw new NotFoundError('Active branch Business Hours could not be found.');
    return row;
  }

  private async requireTenantVersion(
    client: PoolClient,
    tenantId: string,
    expected: number,
  ): Promise<void> {
    const row = await this.requireTenantRow(client, tenantId, true);
    if (row.version !== expected) {
      throw new StaleVersionError(
        'These settings changed since you opened them. Reload to see the latest values.',
      );
    }
  }

  private async assertClosureDoesNotInvalidateAcceptedFittings(
    client: PoolClient,
    context: StaffContext,
    localDate: string,
  ): Promise<void> {
    if (
      await proposedBranchClosureInvalidatesFutureFittings(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        localDate,
      })
    ) {
      throw new ScheduleConflictError(
        'This closed date cannot be added because an accepted future fitting is already scheduled on that date.',
      );
    }
  }
}

function toBusinessSettings(row: TenantSettingsRow): BusinessSettings {
  return businessSettings.parse({
    business_name: row.business_name,
    business_email: row.business_email,
    business_phone: row.business_phone,
    business_address: row.business_address,
    version: row.version,
    timezone: row.timezone,
    currency: row.currency,
    updated_at: row.updated_at.toISOString(),
  });
}

function toBranchBusinessHours(row: BranchBusinessHoursRow): BranchBusinessHours {
  return branchBusinessHours.parse({
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    timezone: row.timezone,
    opens_local: row.operating_hours.opens_local,
    closes_local: row.operating_hours.closes_local,
    closed_weekdays: row.operating_hours.closed_weekdays,
    version: Number(row.version),
    updated_at: row.updated_at.toISOString(),
  });
}

function toBranchClosure(row: BranchClosureRow): BranchClosure {
  return branchClosure.parse({
    id: row.id,
    branch_id: row.branch_id,
    local_date: row.local_date,
    reason: row.reason,
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

function toNotificationSettings(row: TenantSettingsRow): NotificationSettings {
  return notificationSettings.parse({
    ...preferencesOf(row.notification_preferences),
    version: row.version,
    business_recipient: row.business_email,
    updated_at: row.updated_at.toISOString(),
  });
}

function mapBranchClosureWriteConflict(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  ) {
    return new StateConflictError('A special closed date already exists for this branch and date.');
  }
  return error;
}

export const settingsService = new SettingsService();
