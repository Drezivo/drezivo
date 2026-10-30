import { z } from 'zod';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const storefrontSlug = '[a-z0-9-]{1,80}';
const publicRoute = new RegExp(`^/api/media/public/stores/${storefrontSlug}/files/(${uuid})$`, 'i');
const staffRoute = new RegExp(`^/api/v1/files/media/staff/(${uuid})$`, 'i');
const previewRoute = new RegExp(`^/api/v1/public/stores/${storefrontSlug}/media/(${uuid})$`, 'i');
const guestRoute = new RegExp(`^/api/v1/guest/reservations/(${uuid})/media/(${uuid})$`, 'i');
const documentRoute = new RegExp(`^/api/private-documents/staff/(${uuid})$`, 'i');
const branchIdPattern = new RegExp(`^${uuid}$`, 'i');
const widthPattern = /^(?:320|960|1600)$/;

/** API-host media URLs only; R2 and former web-proxy URLs must never cross the API boundary. */
export const mediaUrl = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.hash) {
    context.addIssue({ code: 'custom', message: 'Media URLs must use a secure API origin.' });
    return;
  }

  const path = url.pathname;
  const publicMatch = publicRoute.test(path);
  const staffMatch = staffRoute.test(path);
  const previewMatch = previewRoute.test(path);
  const guestMatch = guestRoute.test(path);
  const documentMatch = documentRoute.test(path);
  if (!publicMatch && !staffMatch && !previewMatch && !guestMatch && !documentMatch) {
    context.addIssue({ code: 'custom', message: 'Media URL is not an approved API media route.' });
    return;
  }

  const params = [...url.searchParams.entries()];
  const widths = params.filter(([key]) => key === 'w');
  const branches = params.filter(([key]) => key === 'branch_id');
  const staffScoped = staffMatch || documentMatch;
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
