/** The app streams staff files through its Clerk-authenticated same-origin route. */
export function staffFileMediaUrl(fileId: string, branchId: string): string {
  return `/api/media/staff/${encodeURIComponent(fileId)}?branch_id=${encodeURIComponent(branchId)}`;
}

/** Public storefronts proxy through their own origin so preview cookies can be forwarded safely. */
export function publicStorefrontMediaUrl(slug: string, fileId: string): string {
  return `/api/media/public/${encodeURIComponent(slug)}/${encodeURIComponent(fileId)}`;
}
