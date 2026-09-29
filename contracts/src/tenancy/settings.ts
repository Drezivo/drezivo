/**
 * Business settings owned by the workspace (not the public storefront): the legal/operating
 * identity used on records and emails, and which email notifications are sent.
 * Timezone and currency are shown but fixed in V1, because reservation money and time rules are
 * PHP and Asia/Manila only.
 */
import { z } from 'zod';

import { contactPhone, plainText } from '../storefront/cms';
import { ianaTimezone, isoInstant } from '../common/time';
import { currencyCode } from '../common/money';

export const businessInformation = z
  .object({
    business_name: plainText(120, { min: 2 }),
    business_email: z.string().trim().toLowerCase().email().max(254).nullable(),
    business_phone: contactPhone.nullable(),
    business_address: plainText(300, { multiline: true }).nullable(),
  })
  .strict();
export type BusinessInformation = z.infer<typeof businessInformation>;

export const businessSettings = businessInformation
  .extend({
    version: z.number().int().positive(),
    timezone: ianaTimezone,
    currency: currencyCode,
    updated_at: isoInstant,
  })
  .strict();
export type BusinessSettings = z.infer<typeof businessSettings>;

export const updateBusinessSettingsRequest = businessInformation
  .extend({ version: z.number().int().positive() })
  .strict();
export type UpdateBusinessSettingsRequest = z.infer<typeof updateBusinessSettingsRequest>;

/** Messages sent to renters. Each flag is honoured by the notification worker at send time. */
export const customerNotificationPreferences = z
  .object({
    request_received: z.boolean(),
    request_confirmed: z.boolean(),
    request_rejected: z.boolean(),
    request_cancelled: z.boolean(),
    fitting_requested: z.boolean(),
  })
  .strict();

/** Alerts sent to the business email. */
export const businessNotificationPreferences = z
  .object({
    new_request: z.boolean(),
    new_fitting_request: z.boolean(),
  })
  .strict();

export const notificationPreferences = z
  .object({
    email_enabled: z.boolean(),
    customer: customerNotificationPreferences,
    business: businessNotificationPreferences,
  })
  .strict();
export type NotificationPreferences = z.infer<typeof notificationPreferences>;

export const notificationSettings = notificationPreferences
  .extend({
    version: z.number().int().positive(),
    /** Where business alerts go. Null means business alerts cannot be delivered yet. */
    business_recipient: z.string().email().nullable(),
    updated_at: isoInstant,
  })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettings>;

export const updateNotificationSettingsRequest = notificationPreferences
  .extend({ version: z.number().int().positive() })
  .strict();
export type UpdateNotificationSettingsRequest = z.infer<typeof updateNotificationSettingsRequest>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  email_enabled: true,
  customer: {
    request_received: true,
    request_confirmed: true,
    request_rejected: true,
    request_cancelled: true,
    fitting_requested: true,
  },
  business: { new_request: true, new_fitting_request: true },
};
