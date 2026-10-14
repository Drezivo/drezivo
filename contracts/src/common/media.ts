import { z } from 'zod';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const storefrontSlug = '[a-z0-9-]{1,80}';

/** Application-owned media routes; absolute HTTPS URLs remain accepted during rolling deploys. */
export const mediaUrl = z.union([
  z.string().url(),
  z.string().regex(new RegExp(`^/api/media/staff/${uuid}(\\?branch_id=${uuid})?$`)),
  z.string().regex(new RegExp(`^/api/media/public/${storefrontSlug}/${uuid}$`)),
]);

export type MediaUrl = z.infer<typeof mediaUrl>;
