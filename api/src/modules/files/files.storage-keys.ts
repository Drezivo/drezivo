/** Uploadable purposes are mapped here to organization-only prefixes in the private bucket. */
export type SupportedUploadPurpose =
  | 'catalogue_image'
  | 'measurement_guide'
  | 'payment_receipt'
  | 'storefront_asset'
  | 'subscription_payment_proof'
  | 'payment_method_material';

const STORAGE_FOLDER_BY_PURPOSE: Record<SupportedUploadPurpose, string> = {
  catalogue_image: 'catalogue-images',
  measurement_guide: 'workspace-assets',
  payment_receipt: 'payment-receipts',
  storefront_asset: 'workspace-assets',
  subscription_payment_proof: 'billing-evidence',
  payment_method_material: 'workspace-assets',
};

/** Builds a tenant-scoped key for staff uploads without accepting client-selected path segments. */
export function staffUploadStorageKey(
  tenantId: string,
  purpose: SupportedUploadPurpose,
  fileId: string,
): string {
  const folder = STORAGE_FOLDER_BY_PURPOSE[purpose];
  return `tenant-files/${tenantId}/${folder}/${fileId}/source`;
}

/** Guest receipt keys retain reservation scope while sharing the payment-receipts category. */
export function guestReceiptStorageKey(
  tenantId: string,
  reservationId: string,
  fileId: string,
): string {
  return `tenant-files/${tenantId}/payment-receipts/${reservationId}/${fileId}/source`;
}

/** Accepts the new key and the previous guest-receipts key for already-authorized uploads. */
export function isGuestReceiptStorageKey(
  storageKey: string,
  tenantId: string,
  reservationId: string,
  fileId: string,
): boolean {
  return (
    storageKey === guestReceiptStorageKey(tenantId, reservationId, fileId) ||
    storageKey === `tenant-files/${tenantId}/guest-receipts/${reservationId}/${fileId}`
  );
}
