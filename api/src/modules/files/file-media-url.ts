import { config } from '../../config/index.js';

/** Staff images stream from the API with Clerk auth and the active branch in request headers. */
export function staffFileMediaUrl(fileId: string, branchId: string, mimeType = 'image/jpeg'): string {
  if (mimeType === 'application/pdf') return staffFileDocumentUrl(fileId, branchId);
  const url = new URL(`/api/v1/files/media/staff/${encodeURIComponent(fileId)}`, config.MEDIA_PUBLIC_ORIGIN);
  url.searchParams.set('branch_id', branchId);
  url.searchParams.set('w', '960');
  return url.toString();
}

/** PDFs keep the existing private app document delivery path. */
export function staffFileDocumentUrl(fileId: string, branchId: string): string {
  const url = new URL(`/api/private-documents/staff/${encodeURIComponent(fileId)}`, config.STAFF_APP_URL);
  url.searchParams.set('branch_id', branchId);
  return url.toString();
}

/** Public images use the API-host Worker; preview files stay private on the versioned API route. */
export function publicStorefrontMediaUrl(
  slug: string,
  fileId: string,
  preview = false,
  mimeType = 'image/jpeg',
): string {
  const encodedSlug = encodeURIComponent(slug);
  const encodedFileId = encodeURIComponent(fileId);
  const path = preview || mimeType === 'application/pdf'
    ? `/api/v1/public/stores/${encodedSlug}/media/${encodedFileId}`
    : `/api/media/public/stores/${encodedSlug}/files/${encodedFileId}`;
  const url = new URL(path, config.MEDIA_PUBLIC_ORIGIN);
  url.searchParams.set('w', '960');
  return url.toString();
}

/** Reservation-scoped guest media is fetched with a short-lived grant in a request header. */
export function guestRenterStepsMediaUrl(reservationId: string, fileId: string): string {
  return new URL(
    `/api/v1/guest/reservations/${encodeURIComponent(reservationId)}/media/${encodeURIComponent(fileId)}`,
    config.MEDIA_PUBLIC_ORIGIN,
  ).toString();
}
