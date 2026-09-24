import { z } from 'zod';

import { fileObjectId, paymentMethodId } from '../common/ids';
import { paymentRail } from '../finance/payment-status';

export const paymentDestination = z
  .object({
    account_name: z.string().trim().max(160).nullable(),
    account_number: z.string().trim().max(120).nullable(),
    instructions: z.string().trim().max(500).nullable(),
  })
  .strict();
export type PaymentDestination = z.infer<typeof paymentDestination>;

export const paymentMethodSettingsItem = z
  .object({
    id: paymentMethodId,
    name: z.string().trim().min(1).max(200),
    rail: paymentRail,
    active: z.boolean(),
    storefront_enabled: z.boolean(),
    storefront_ready: z.boolean(),
    version: z.number().int().positive(),
    destination: paymentDestination,
    qr_file_id: fileObjectId.nullable(),
  })
  .strict();
export type PaymentMethodSettingsItem = z.infer<typeof paymentMethodSettingsItem>;

export const paymentMethodSettingsList = z
  .object({
    items: z.array(paymentMethodSettingsItem).max(20),
  })
  .strict();
export type PaymentMethodSettingsList = z.infer<typeof paymentMethodSettingsList>;

export const updatePaymentMethodSettingsRequest = z
  .object({
    version: z.number().int().positive(),
    active: z.boolean(),
    storefront_enabled: z.boolean(),
    destination: paymentDestination,
    qr_file_id: fileObjectId.nullable(),
  })
  .strict();
export type UpdatePaymentMethodSettingsRequest = z.infer<typeof updatePaymentMethodSettingsRequest>;
