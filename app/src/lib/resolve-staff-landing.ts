"use client";

import type { ActorContext, WorkspaceSummary } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { listAllAccessibleWorkspaces } from "@/lib/workspace-access";

type SetActiveOrganization = (params: { organization: string | null }) => Promise<unknown>;

export type StaffLandingResolution =
  | { kind: "workspace"; workspace: WorkspaceSummary; actor: ActorContext }
  | { kind: "workspaces"; workspaces: WorkspaceSummary[] }
  | { kind: "invitation-required" }
  | { kind: "onboarding" };

const SET_ACTIVE_TIMEOUT_MS = 10_000;
/**
 * Read-only invitation hints from Clerk. Invitations are accepted only on their link-scoped
 * Drezivo route; this resolver must never accept pending invitations or infer access from them.
 */
export type StaffInvitationState = {
  loadPending: () => Promise<Array<unknown>>;
  /** True when the user already belongs to a Clerk organization as a plain member. */
  isInvitedMember: boolean;
};

/** The parts of Clerk's signed-in user this module reads (structural, so tests need no Clerk). */
type ClerkInvitationUser = {
  organizationMemberships: ReadonlyArray<{ role: string }>;
  getOrganizationInvitations: (params: { status: "pending" }) => Promise<{ data: Array<unknown> }>;
};

export function invitationStateOf(
  user: ClerkInvitationUser | null | undefined
): StaffInvitationState | undefined {
  if (!user) return undefined;
  return {
    loadPending: async () => (await user.getOrganizationInvitations({ status: "pending" })).data,
    isInvitedMember: user.organizationMemberships.some(
      (membership) => membership.role === "org:member"
    ),
  };
}

/**
 * Clerk's Next.js `setActive` first runs a cache-invalidation server action and only settles when
 * that action succeeds; if it fails, the promise never resolves. Bound it so a stuck switch
 * surfaces as a retryable error instead of an endless "Opening your workspace" spinner.
 */
async function activateOrganization(
  setActive: SetActiveOrganization,
  organization: string | null
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new DrezivoApiError("Switching to your workspace took too long. Please try again.", {
            status: 504,
          })
        ),
      SET_ACTIVE_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([setActive({ organization }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveStaffLanding({
  activeOrganizationId,
  getToken,
  setActive,
  invitations,
  requireWorkspaceChoice = false,
}: {
  activeOrganizationId: string | null | undefined;
  getToken: () => Promise<string | null>;
  setActive: SetActiveOrganization;
  invitations?: StaffInvitationState | undefined;
  /** Post-auth navigation requires an explicit choice whenever more than one workspace exists. */
  requireWorkspaceChoice?: boolean;
}): Promise<StaffLandingResolution> {
  const api = createDrezivoApiClient(getToken);
  const workspaces = await listAllAccessibleWorkspaces(api);

  if (workspaces.length === 0) {
    const pending = invitations ? await invitations.loadPending() : [];
    if (pending.length > 0 || invitations?.isInvitedMember) return { kind: "invitation-required" };
    if (activeOrganizationId) {
      await activateOrganization(setActive, null);
    }

    const onboarding = await api.getCurrentOnboarding();
    if (onboarding.data.has_current_owned_tenant) {
      throw new DrezivoApiError(
        "Your account has a workspace record, but no accessible workspace membership could be resolved.",
        { status: 409 }
      );
    }

    return { kind: "onboarding" };
  }

  const activeWorkspace = workspaces.find((item) => item.clerk_org_id === activeOrganizationId);
  if (workspaces.length > 1 && (requireWorkspaceChoice || !activeWorkspace)) {
    return { kind: "workspaces", workspaces };
  }
  const workspace = activeWorkspace ?? workspaces[0];

  if (!workspace) {
    throw new DrezivoApiError("Your workspace could not be resolved. Please try again.", {
      status: 409,
    });
  }

  if (activeOrganizationId !== workspace.clerk_org_id) {
    await activateOrganization(setActive, workspace.clerk_org_id);
  }

  const actor = await api.getActorContext();
  if (
    actor.data.tenant.id !== workspace.tenant.id ||
    actor.data.membership.role !== workspace.role
  ) {
    throw new DrezivoApiError(
      "Your active workspace did not match the workspace assigned to this account.",
      { status: 409 }
    );
  }

  return { kind: "workspace", workspace, actor: actor.data };
}
