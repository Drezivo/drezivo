import { z } from 'zod';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const storefrontSlug = '[a-z0-9-]{1,80}';
const publicRoute = new RegExp(`^/api/media/public/stores/${storefrontSlug}/files/(${uuid})$`, 'i');
const staffRoute = new RegExp(`^/api/v1/files/media/staff/(${uuid})$`, 'i');
const relativeStaffRoute = new RegExp(`^/api/media/staff/(${uuid})$`, 'i');
const previewRoute = new RegExp(`^/api/v1/public/stores/${storefrontSlug}/media/(${uuid})$`, 'i');
const guestRoute = new RegExp(`^/api/v1/guest/reservations/(${uuid})/media/(${uuid})$`, 'i');
const documentRoute = new RegExp(`^/api/private-documents/staff/(${uuid})$`, 'i');
const branchIdPattern = new RegExp(`^${uuid}$`, 'i');
const widthPattern = /^(?:320|960|1600)$/;

/** Approved API media URLs; relative staff URLs resolve on the authenticated app origin. */
export const mediaUrl = z.string().superRefine((value, context) => {
  if (value !== value.trim() || value.startsWith('//')) {
    context.addIssue({ code: 'custom', message: 'Media URLs must use a secure API origin.' });
    return;
  }

  const isRelative = value.startsWith('/');
  let url: URL;
  try {
    url = isRelative ? new URL(value, 'https://media.invalid') : new URL(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Media URLs must use a secure API origin.' });
    return;
  }

  const relativeStaffMatch = isRelative && relativeStaffRoute.test(url.pathname);
  if (isRelative && (url.origin !== 'https://media.invalid' || !relativeStaffMatch)) {
    context.addIssue({ code: 'custom', message: 'Media URL is not an approved API media route.' });
    return;
  }

  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!isRelative && url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.hash) {
    context.addIssue({ code: 'custom', message: 'Media URLs must use a secure API origin.' });
    return;
  }

  const path = url.pathname;
  const publicMatch = publicRoute.test(path);
  const staffMatch = staffRoute.test(path);
  const previewMatch = previewRoute.test(path);
  const guestMatch = guestRoute.test(path);
  const documentMatch = documentRoute.test(path);
  if (!publicMatch && !staffMatch && !relativeStaffMatch && !previewMatch && !guestMatch && !documentMatch) {
    context.addIssue({ code: 'custom', message: 'Media URL is not an approved API media route.' });
    return;
  }

  const params = [...url.searchParams.entries()];
  const widths = params.filter(([key]) => key === 'w');
  const branches = params.filter(([key]) => key === 'branch_id');
  const staffScoped = staffMatch || documentMatch || relativeStaffMatch;
  const hasValidQuery =
    params.length === widths.length + branches.length &&
    widths.length <= 1 &&
    branches.length === (staffScoped ? 1 : 0) &&
    widths.every(([, width]) => widthPattern.test(width)) &&
    branches.every(([, branchId]) => branchIdPattern.test(branchId));
  if (!hasValidQuery) {
    context.addIssue({ code: 'custom', message: 'Media URL has unsupported query parameters.' });
  }
});

export type MediaUrl = z.infer<typeof mediaUrl>;
