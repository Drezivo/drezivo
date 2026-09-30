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

/**
 * How a business describes an online payment method to renters: typed details (account and optional QR),
 * or its own ready-made instructions file (PDF or image) that already carries the QR and steps.
 */
export const paymentMethodPresentation = z.enum(['details', 'material']);
export type PaymentMethodPresentation = z.infer<typeof paymentMethodPresentation>;

/** Online (non-cash) payment methods a business may keep active at once. Cash is separate and staff-only. */
export const MAX_ONLINE_PAYMENT_METHODS = 5;

export const paymentMethodMaterial = z
  .object({
    file_id: fileObjectId,
    content_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  })
  .strict();
export type PaymentMethodMaterial = z.infer<typeof paymentMethodMaterial>;

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
    presentation: paymentMethodPresentation,
    material: paymentMethodMaterial.nullable(),
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
    // Optional so an app build from before instruction files keeps working; absent keeps the stored value.
    presentation: paymentMethodPresentation.optional(),
    material_file_id: fileObjectId.nullable().optional(),
  })
  .strict();
export type UpdatePaymentMethodSettingsRequest = z.infer<typeof updatePaymentMethodSettingsRequest>;

/** POST /payment-methods (Idempotency-Key). Returns 409 PAYMENT_METHOD_LIMIT beyond the limit. */
export const createPaymentMethodRequest = z
  .object({
    name: z.string().trim().min(1).max(80),
    rail: z.enum(['manual_qr', 'manual_transfer']),
    storefront_enabled: z.boolean(),
    destination: paymentDestination,
    qr_file_id: fileObjectId.nullable(),
    presentation: paymentMethodPresentation,
    material_file_id: fileObjectId.nullable(),
  })
  .strict();
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodRequest>;

/** POST /payment-methods/{id}/archive (Idempotency-Key). Cash cannot be archived. */
export const archivePaymentMethodRequest = z.object({ version: z.number().int().positive() }).strict();
export type ArchivePaymentMethodRequest = z.infer<typeof archivePaymentMethodRequest>;
