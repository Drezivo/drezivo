/**
 * TRD §3 — the resolved result of the staff request path: verified Clerk
 * identity mapped to "the unique local tenant; resolve the local active
 * membership and server-defined capability." `app` fetches this once per
 * session bootstrap (and after an organization switch) to know which
 * branches and capabilities the current actor actually has — never trusting
 * a role or branch id the browser already had cached.
 */
import { z } from 'zod';

import { paginatedResponse } from '../common/pagination';
import { isoInstant } from '../common/time';
import { branch, branchGrant, membership, membershipRole, tenant } from './tenant';
import { subscriptionAccess } from './billing';
import { subscriptionSummary } from './onboarding';

export const actorContext = z.object({
  tenant,
  membership,
  branches: z.array(branch).min(1),
  active_branch_id: branch.shape.id,
  branch_grants: z.array(branchGrant).min(1),
  subscription: subscriptionSummary,
  /** Derived at request time from the subscription; see ./billing.ts. */
  access: subscriptionAccess,
  entitlements: z.object({
    physical_assets_max: z.number().int().positive(),
    frontdesk_seats_max: z.number().int().nonnegative(),
  }),
});
export type ActorContext = z.infer<typeof actorContext>;

/** Safe workspace switcher projection. It never includes membership IDs or profile data. */
export const workspaceSummary = z.object({
  tenant,
  clerk_org_id: z.string().trim().min(1).max(200),
  role: membershipRole,
  membership_updated_at: isoInstant,
});
export type WorkspaceSummary = z.infer<typeof workspaceSummary>;

export const workspaceList = paginatedResponse(workspaceSummary);
export type WorkspaceList = z.infer<typeof workspaceList>;
