/** Canonical fitting lifecycle and staff-facing operational metadata. */
import { z } from 'zod';

/**
 * BE-0 canonical persisted fitting states. Payment/evidence is deliberately
 * separate and must never be inferred from these values.
 */
export const fittingState = z.enum(['pending', 'confirmed', 'completed', 'rejected', 'cancelled', 'no_show']);
export type FittingState = z.infer<typeof fittingState>;

/** First production slice is staff-created only; the field is server-owned. */
/** `storefront` marks a fitting a guest requested from the public storefront. */
export const fittingBookingChannel = z.enum(['staff', 'storefront']);
export type FittingBookingChannel = z.infer<typeof fittingBookingChannel>;

/** Preference-only never claims inventory; guaranteed must own one real asset allocation. */
export const fittingGarmentMode = z.enum(['preference', 'guaranteed']);
export type FittingGarmentMode = z.infer<typeof fittingGarmentMode>;

/** Time-derived attention is presentation metadata, never an automatic state transition. */
export const fittingAttention = z.enum(['none', 'outcome_required']);
export type FittingAttention = z.infer<typeof fittingAttention>;

/**
 * Server-calculated actions available to the current authenticated staff actor.
 * This is advisory UI metadata; each mutation still re-authorizes and rechecks
 * state/time guards transactionally.
 */
export const fittingAction = z.enum([
  'confirm',
  'reject',
  'cancel',
  'complete',
  'mark_no_show',
  'reschedule',
  'update_garments',
  'update_note',
]);
export type FittingAction = z.infer<typeof fittingAction>;
