/**
 * TRD §3 — the resolved result of the staff request path: verified Clerk
 * identity mapped to "the unique local tenant; resolve the local active
 * membership and server-defined capability." `app` fetches this once per
 * session bootstrap (and after an organization switch) to know which
 * branches and capabilities the current actor actually has — never trusting
 * a role or branch id the browser already had cached.
 */
import { z } from 'zod';

import { branchGrant, membership, tenant } from './tenant';

export const actorContext = z.object({
  tenant,
  membership,
  branch_grants: z.array(branchGrant).min(1),
});
export type ActorContext = z.infer<typeof actorContext>;
