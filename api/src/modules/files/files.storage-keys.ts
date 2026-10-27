/** Uploadable purposes are mapped here to organization-only prefixes in the private bucket. */
export type SupportedUploadPurpose =
  | 'catalogue_image'
  | 'measurement_guide'
  | 'payment_receipt'
  | 'storefront_asset'
  | 'subscription_payment_proof'
  | 'payment_method_material'
  | 'catalogue_backup';

const STORAGE_FOLDER_BY_PURPOSE: Record<SupportedUploadPurpose, string> = {
  catalogue_image: 'catalogue-images',
  measurement_guide: 'workspace-assets',
  payment_receipt: 'payment-receipts',
  storefront_asset: 'workspace-assets',
  subscription_payment_proof: 'billing-evidence',
  payment_method_material: 'workspace-assets',
  catalogue_backup: 'catalogue-backups',
};

export const IMAGE_VARIANT_WIDTHS = [320, 960, 1600] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

export type ImageVariantPurpose = Extract<
  SupportedUploadPurpose,
  'catalogue_image' | 'measurement_guide' | 'storefront_asset' | 'payment_method_material'
>;

const IMAGE_VARIANT_PURPOSES: ReadonlySet<string> = new Set([
  'catalogue_image',
  'measurement_guide',
  'storefront_asset',
  'payment_method_material',
]);

/** Builds a tenant-scoped key for staff uploads without accepting client-selected path segments. */
export function staffUploadStorageKey(
  tenantId: string,
  purpose: SupportedUploadPurpose,
  fileId: string,
): string {
  const folder = STORAGE_FOLDER_BY_PURPOSE[purpose];
  return `tenant-files/${tenantId}/${folder}/${fileId}/source`;
}

export function supportsImageVariants(
  purpose: string,
  mimeType: string,
): purpose is ImageVariantPurpose {
  return IMAGE_VARIANT_PURPOSES.has(purpose) &&
    (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp');
}

export function imageVariantStorageKey(input: {
  tenantId: string;
  purpose: ImageVariantPurpose;
  fileId: string;
  storageKey: string;
  width: ImageVariantWidth;
}): string | null {
  if (staffUploadStorageKey(input.tenantId, input.purpose, input.fileId) !== input.storageKey) {
    return null;
  }
  return `${input.storageKey.slice(0, -'/source'.length)}/variants/v1/${input.width}.webp`;
}

/** Derives only paths inside application-created image directories for cleanup retries. */
export function imageVariantStorageKeysFromSource(storageKey: string): string[] {
  if (!/^tenant-files\/[0-9a-f-]{36}\/(?:catalogue-images|workspace-assets)\/[0-9a-f-]{36}\/source$/i.test(storageKey)) {
    return [];
  }
  const prefix = storageKey.slice(0, -'/source'.length);
  return IMAGE_VARIANT_WIDTHS.map((width) => `${prefix}/variants/v1/${width}.webp`);
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
