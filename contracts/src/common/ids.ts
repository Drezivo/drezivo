/**
 * TRD §4 — "Use opaque IDs and ISO timestamps."
 * Data-Model §2 — "Tenant-owned primary keys are (tenant_id,id). UUIDs are
 * generated server-side."
 *
 * IDs are opaque strings from the consumer's point of view: a caller must
 * never parse, decrement, or guess one. Branding each resource's ID type
 * separately means `passReservationId(customerId)` is a compile-time error
 * instead of a runtime cross-tenant data leak waiting to happen.
 */
import { z } from 'zod';

const uuid = z.string().uuid();

/** Builds a branded, opaque ID schema for one resource kind. */
function idSchema<Brand extends string>(_brand: Brand) {
  return uuid.brand<Brand>();
}

export const tenantId = idSchema('TenantId');
export type TenantId = z.infer<typeof tenantId>;

export const branchId = idSchema('BranchId');
export type BranchId = z.infer<typeof branchId>;

export const membershipId = idSchema('MembershipId');
export type MembershipId = z.infer<typeof membershipId>;

export const accountId = idSchema('AccountId');
export type AccountId = z.infer<typeof accountId>;

export const organizationOnboardingId = idSchema('OrganizationOnboardingId');
export type OrganizationOnboardingId = z.infer<typeof organizationOnboardingId>;

export const membershipInvitationId = idSchema('MembershipInvitationId');
export type MembershipInvitationId = z.infer<typeof membershipInvitationId>;

export const subscriptionId = idSchema('SubscriptionId');
export type SubscriptionId = z.infer<typeof subscriptionId>;

export const operatorActionId = idSchema('OperatorActionId');
export type OperatorActionId = z.infer<typeof operatorActionId>;

export const customerId = idSchema('CustomerId');
export type CustomerId = z.infer<typeof customerId>;

export const categoryId = idSchema('CategoryId');
export type CategoryId = z.infer<typeof categoryId>;

export const productId = idSchema('ProductId');
export type ProductId = z.infer<typeof productId>;

export const productVariantId = idSchema('ProductVariantId');
export type ProductVariantId = z.infer<typeof productVariantId>;

export const physicalAssetId = idSchema('PhysicalAssetId');
export type PhysicalAssetId = z.infer<typeof physicalAssetId>;

export const maintenanceWorkOrderId = idSchema('MaintenanceWorkOrderId');
export type MaintenanceWorkOrderId = z.infer<typeof maintenanceWorkOrderId>;

export const assetAllocationId = idSchema('AssetAllocationId');
export type AssetAllocationId = z.infer<typeof assetAllocationId>;

export const measurementGuideId = idSchema('MeasurementGuideId');
export type MeasurementGuideId = z.infer<typeof measurementGuideId>;

export const storefrontId = idSchema('StorefrontId');
export type StorefrontId = z.infer<typeof storefrontId>;

export const paymentMethodId = idSchema('PaymentMethodId');
export type PaymentMethodId = z.infer<typeof paymentMethodId>;

export const reservationId = idSchema('ReservationId');
export type ReservationId = z.infer<typeof reservationId>;

export const reservationLineId = idSchema('ReservationLineId');
export type ReservationLineId = z.infer<typeof reservationLineId>;

export const fittingId = idSchema('FittingId');
export type FittingId = z.infer<typeof fittingId>;

export const fittingLineId = idSchema('FittingLineId');
export type FittingLineId = z.infer<typeof fittingLineId>;

export const branchClosureId = idSchema('BranchClosureId');
export type BranchClosureId = z.infer<typeof branchClosureId>;

export const paymentId = idSchema('PaymentId');
export type PaymentId = z.infer<typeof paymentId>;

export const paymentReceiptId = idSchema('PaymentReceiptId');
export type PaymentReceiptId = z.infer<typeof paymentReceiptId>;

export const refundId = idSchema('RefundId');
export type RefundId = z.infer<typeof refundId>;

export const chargeId = idSchema('ChargeId');
export type ChargeId = z.infer<typeof chargeId>;

export const fileObjectId = idSchema('FileObjectId');
export type FileObjectId = z.infer<typeof fileObjectId>;

export const exportJobId = idSchema('ExportJobId');
export type ExportJobId = z.infer<typeof exportJobId>;

export const guestAccessTokenId = idSchema('GuestAccessTokenId');
export type GuestAccessTokenId = z.infer<typeof guestAccessTokenId>;

export const supportGrantId = idSchema('SupportGrantId');
export type SupportGrantId = z.infer<typeof supportGrantId>;

export const auditEventId = idSchema('AuditEventId');
export type AuditEventId = z.infer<typeof auditEventId>;

export const outboxEventId = idSchema('OutboxEventId');
export type OutboxEventId = z.infer<typeof outboxEventId>;
