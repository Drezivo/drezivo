/** The app streams staff files through its Clerk-authenticated same-origin route. */
export function staffFileMediaUrl(fileId: string, branchId: string): string {
  return `/api/media/staff/${encodeURIComponent(fileId)}?branch_id=${encodeURIComponent(branchId)}&w=960`;
}

/** Public storefronts proxy through their own origin so preview cookies can be forwarded safely. */
export function publicStorefrontMediaUrl(slug: string, fileId: string, preview = false): string {
  const route = preview ? 'preview' : 'public';
  return `/api/media/${route}/${encodeURIComponent(slug)}/${encodeURIComponent(fileId)}?w=960`;
}
