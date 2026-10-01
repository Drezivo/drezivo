/** Shared fitting wire projections for list/detail/create/action responses. */
import { z } from 'zod';

import { customerAddress, customerSocialMedia } from '../common/customer';
import {
  branchId,
  customerId,
  fittingId,
  fittingLineId,
  paymentId,
  physicalAssetId,
  productVariantId,
} from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { ianaTimezone, instantInterval, isoInstant } from '../common/time';
import { paymentEvidenceStatus, paymentStatus } from '../finance/payment-status';
import {
  fittingAction,
  fittingAttention,
  fittingBookingChannel,
  fittingGarmentMode,
  fittingState,
} from './state';

export const FITTING_MAX_GARMENT_LINES = 20;
export const FITTING_INTERNAL_NOTE_MAX_LENGTH = 2_000;
export const FITTING_TERMINAL_REASON_MAX_LENGTH = 500;

/** Route params for one fitting appointment. */
export const fittingParams = z
  .object({
    id: fittingId,
  })
  .strict();
export type FittingParams = z.infer<typeof fittingParams>;

/** Minimal customer identity safe for the operational fitting list. */
export const fittingCustomerSummary = z
  .object({
    id: customerId,
    full_name: z.string().trim().min(1).max(300),
  })
  .strict();
export type FittingCustomerSummary = z.infer<typeof fittingCustomerSummary>;

/** Staff-only customer details shown inside the fitting detail surface. */
export const fittingCustomerDetail = fittingCustomerSummary
  .extend({
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().email().max(320).nullable(),
    address: customerAddress.nullable(),
    social_media: customerSocialMedia.nullable(),
  })
  .strict();
export type FittingCustomerDetail = z.infer<typeof fittingCustomerDetail>;

/** Existing finance state projected for a fitting without creating a second payment authority. */
export const fittingPaymentSummary = z
  .object({
    id: paymentId,
    status: paymentStatus,
    evidence_status: paymentEvidenceStatus,
    amount_minor: nonNegativeMoneyString,
    currency: currencyCode,
    verified_at: isoInstant.nullable(),
  })
  .strict();
export type FittingPaymentSummary = z.infer<typeof fittingPaymentSummary>;

/**
 * Snapshotted fitting fee plus current finance projection. A zero-fee fitting
 * has no payment obligation and therefore cannot expose a payment record here.
 */
export const fittingFeePaymentSummary = z
  .object({
    fee_minor: nonNegativeMoneyString,
    currency: currencyCode,
    payment: fittingPaymentSummary.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (BigInt(value.fee_minor) === 0n && value.payment !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment'],
        message: 'A zero-fee fitting cannot expose a payment obligation.',
      });
    }
    if (value.payment !== null && value.payment.currency !== value.currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'currency'],
        message: 'Fitting payment currency must match the snapshotted fitting fee currency.',
      });
    }
  });
export type FittingFeePaymentSummary = z.infer<typeof fittingFeePaymentSummary>;

/** Human-readable variant facts needed by fitting list/detail screens. */
export const fittingVariantSummary = z
  .object({
    variant_id: productVariantId,
    product_name: z.string().trim().min(1).max(300),
    sku: z.string().trim().min(1).max(120),
    // Null is the canonical wire representation for a product's single Free size variant.
    size_label: z.string().trim().min(1).max(40).nullable(),
    color_label: z.string().trim().min(1).max(80).nullable(),
    primary_image_url: z.string().url().nullable().optional(),
  })
  .strict();
export type FittingVariantSummary = z.infer<typeof fittingVariantSummary>;

/** Compact line projection for list/review surfaces. */
export const fittingGarmentLineSummary = z
  .object({
    id: fittingLineId,
    variant: fittingVariantSummary,
    garment_mode: fittingGarmentMode,
  })
  .strict();
export type FittingGarmentLineSummary = z.infer<typeof fittingGarmentLineSummary>;

const fittingAssignedAsset = z
  .object({
    id: physicalAssetId,
    asset_code: z.string().trim().min(1).max(120),
  })
  .strict();

/**
 * Detail line preserves the preference/guarantee invariant on the wire:
 * preference has no asset; guaranteed always exposes the real assigned asset.
 */
export const fittingGarmentLineDetail = fittingGarmentLineSummary
  .extend({
    assigned_asset: fittingAssignedAsset.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.garment_mode === 'preference' && value.assigned_asset !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assigned_asset'],
        message: 'Preference-only fitting lines cannot carry an assigned physical asset.',
      });
    }
    if (value.garment_mode === 'guaranteed' && value.assigned_asset === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assigned_asset'],
        message: 'Guaranteed fitting lines must expose their assigned physical asset.',
      });
    }
  });
export type FittingGarmentLineDetail = z.infer<typeof fittingGarmentLineDetail>;

/** Canonical staff detail projection; hidden capacity-slot identifiers never appear here. */
export const fittingDetail = z
  .object({
    id: fittingId,
    branch_id: branchId,
    booking_channel: fittingBookingChannel,
    status: fittingState,
    period: instantInterval,
    timezone_snapshot: ianaTimezone,
    customer: fittingCustomerDetail,
    garments: z.array(fittingGarmentLineDetail).min(1).max(FITTING_MAX_GARMENT_LINES),
    fee: fittingFeePaymentSummary,
    internal_note: z.string().trim().max(FITTING_INTERNAL_NOTE_MAX_LENGTH).nullable(),
    terminal_reason: z.string().trim().min(1).max(FITTING_TERMINAL_REASON_MAX_LENGTH).nullable(),
    attention: fittingAttention,
    allowed_actions: z.array(fittingAction).max(fittingAction.options.length),
    version: z.number().int().positive(),
    created_at: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const requiresReason = value.status === 'rejected' || value.status === 'cancelled';
    if (requiresReason && value.terminal_reason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal_reason'],
        message: 'Rejected and cancelled fittings require a terminal reason.',
      });
    }
    if (!requiresReason && value.terminal_reason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal_reason'],
        message: 'Only rejected or cancelled fittings may carry a terminal reason.',
      });
    }
  });
export type FittingDetail = z.infer<typeof fittingDetail>;
