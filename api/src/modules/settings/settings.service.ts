import type { PoolClient } from 'pg';

import {
  businessSettings,
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationSettings,
  type BusinessSettings,
  type NotificationPreferences,
  type NotificationSettings,
  type UpdateBusinessSettingsRequest,
  type UpdateNotificationSettingsRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { StaffContext } from '../../middleware/staff-command.js';
import {
  ForbiddenError,
  NotFoundError,
  StaleVersionError,
  TenantCancelledError,
  TenantRestrictedError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import {
  appendSettingsAudit,
  readTenantSettings,
  updateBusinessInformation,
  updateNotificationPreferences,
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
    email_enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_NOTIFICATION_PREFERENCES.email_enabled,
    customer: pick(DEFAULT_NOTIFICATION_PREFERENCES.customer, stored['customer']),
    business: pick(DEFAULT_NOTIFICATION_PREFERENCES.business, stored['business']),
  };
}

/** Business information and email notification settings. Owner-only writes (`policies.manage`). */
export class SettingsService {
  getBusiness(context: StaffContext): Promise<BusinessSettings> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) =>
      toBusinessSettings(await this.requireRow(client, context.tenantId, false)),
    );
  }

  getNotifications(context: StaffContext): Promise<NotificationSettings> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) =>
      toNotificationSettings(await this.requireRow(client, context.tenantId, false)),
    );
  }

  updateBusiness(context: StaffContext, key: string, request: UpdateBusinessSettingsRequest): Promise<CommandResult<BusinessSettings>> {
    return this.command(context, key, 'settings.business.update', request, async (client) => {
      const { version, ...info } = request;
      await this.requireVersion(client, context.tenantId, version);
      await updateBusinessInformation(client, { tenantId: context.tenantId, expectedVersion: version, info });
      await appendSettingsAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'settings.business.updated',
        summary: { has_email: info.business_email !== null, has_phone: info.business_phone !== null },
        requestId: context.requestId,
      });
      return toBusinessSettings(await this.requireRow(client, context.tenantId, false));
    });
  }

  updateNotifications(
    context: StaffContext,
    key: string,
    request: UpdateNotificationSettingsRequest,
  ): Promise<CommandResult<NotificationSettings>> {
    return this.command(context, key, 'settings.notifications.update', request, async (client) => {
      const { version, ...preferences } = request;
      await this.requireVersion(client, context.tenantId, version);
      await updateNotificationPreferences(client, { tenantId: context.tenantId, expectedVersion: version, preferences });
      await appendSettingsAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'settings.notifications.updated',
        summary: { email_enabled: preferences.email_enabled },
        requestId: context.requestId,
      });
      return toNotificationSettings(await this.requireRow(client, context.tenantId, false));
    });
  }

  private command<T>(
    context: StaffContext,
    key: string,
    operation: string,
    payload: unknown,
    execute: (client: PoolClient) => Promise<T>,
  ): Promise<CommandResult<T>> {
    if (!context.permissionCodes.includes('policies.manage')) {
      throw new ForbiddenError('Only the business owner can change business settings.');
    }
    if (context.effectiveTenantStatus === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
    if (context.effectiveTenantStatus === 'cancelled') throw new TenantCancelledError('This workspace is closed.');
    return withTenantTransaction(context.tenantId, context.principalId, (client) =>
      runIdempotentCommand(
        client,
        { tenantId: context.tenantId, principalKey: context.membershipId, operation, intentKey: key, requestId: context.requestId },
        payload,
        () => execute(client),
      ),
    );
  }

  private async requireRow(client: PoolClient, tenantId: string, forUpdate: boolean): Promise<TenantSettingsRow> {
    const row = await readTenantSettings(client, tenantId, forUpdate);
    if (!row) throw new NotFoundError('Workspace settings could not be found.');
    return row;
  }

  private async requireVersion(client: PoolClient, tenantId: string, expected: number): Promise<void> {
    const row = await this.requireRow(client, tenantId, true);
    if (row.version !== expected) {
      throw new StaleVersionError('These settings changed since you opened them. Reload to see the latest values.');
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

function toNotificationSettings(row: TenantSettingsRow): NotificationSettings {
  return notificationSettings.parse({
    ...preferencesOf(row.notification_preferences),
    version: row.version,
    business_recipient: row.business_email,
    updated_at: row.updated_at.toISOString(),
  });
}

export const settingsService = new SettingsService();
