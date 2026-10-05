"use client";

import type { ActorContext, WorkspaceSummary } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

type SetActiveOrganization = (params: { organization: string | null }) => Promise<unknown>;

export type StaffLandingResolution =
  | { kind: "workspace"; workspace: WorkspaceSummary; actor: ActorContext }
  | { kind: "onboarding" };

const SET_ACTIVE_TIMEOUT_MS = 10_000;
/** How long an invited member waits for the server to finish claiming their seat. */
const CLAIM_WAIT_ATTEMPTS = 8;
const CLAIM_WAIT_INTERVAL_MS = 1_500;

/**
 * What Clerk knows about a signed-in user's organization invitations. An invited front-desk
 * member joins the business's Clerk organization as `org:member`; the API then claims their
 * Drezivo seat from Clerk's invitation-accepted webhook, a moment after sign-in.
 */
export type StaffInvitationState = {
  /** Pending Clerk organization invitations addressed to this user, each able to accept itself. */
  loadPending: () => Promise<Array<{ accept: () => Promise<unknown> }>>;
  /** True when the user already belongs to a Clerk organization as a plain member. */
  isInvitedMember: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The parts of Clerk's signed-in user this module reads (structural, so tests need no Clerk). */
type ClerkInvitationUser = {
  organizationMemberships: ReadonlyArray<{ role: string }>;
  getOrganizationInvitations: (params: {
    status: "pending";
  }) => Promise<{ data: Array<{ accept: () => Promise<unknown> }> }>;
};

export function invitationStateOf(user: ClerkInvitationUser | null | undefined): StaffInvitationState | undefined {
  if (!user) return undefined;
  return {
    loadPending: async () => (await user.getOrganizationInvitations({ status: "pending" })).data,
    isInvitedMember: user.organizationMemberships.some((membership) => membership.role === "org:member"),
  };
}

/**
 * Clerk's Next.js `setActive` first runs a cache-invalidation server action and only settles when
 * that action succeeds; if it fails, the promise never resolves. Bound it so a stuck switch
 * surfaces as a retryable error instead of an endless "Opening your workspace" spinner.
 */
async function activateOrganization(setActive: SetActiveOrganization, organization: string | null): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DrezivoApiError("Switching to your workspace took too long. Please try again.", { status: 504 })),
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
  waitMs = CLAIM_WAIT_INTERVAL_MS,
}: {
  activeOrganizationId: string | null | undefined;
  getToken: () => Promise<string | null>;
  setActive: SetActiveOrganization;
  invitations?: StaffInvitationState | undefined;
  /** Delay between workspace checks while a claim is pending; tests pass 0. */
  waitMs?: number;
}): Promise<StaffLandingResolution> {
  const api = createDrezivoApiClient(getToken);
  let workspaces = await api.getWorkspaces();

  if (workspaces.data.items.length === 0 && invitations) {
    // Someone invited to a business must land in that business, never in "create your own".
    // Accepting a pending invitation here covers people who signed up on /sign-up instead of
    // following Clerk's invitation link.
    const pending = await invitations.loadPending();
    for (const invitation of pending) await invitation.accept();
    if (pending.length > 0 || invitations.isInvitedMember) {
      for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS && workspaces.data.items.length === 0; attempt += 1) {
        await sleep(waitMs);
        workspaces = await api.getWorkspaces();
      }
      if (workspaces.data.items.length === 0) {
        throw new DrezivoApiError(
          "Your invitation is still being set up. Please wait a minute, then try again.",
          { status: 409 }
        );
      }
    }
  }

  if (workspaces.data.items.length === 0) {
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

  const workspace =
    workspaces.data.items.find((item) => item.clerk_org_id === activeOrganizationId) ??
    workspaces.data.items[0];

  if (!workspace) {
    throw new DrezivoApiError("Your workspace could not be resolved. Please try again.", {
      status: 409,
    });
  }

  if (activeOrganizationId !== workspace.clerk_org_id) {
    await activateOrganization(setActive, workspace.clerk_org_id);
  }

  const actor = await api.getActorContext();
  if (actor.data.tenant.id !== workspace.tenant.id) {
    throw new DrezivoApiError(
      "Your active workspace did not match the workspace assigned to this account.",
      { status: 409 }
    );
  }

  return { kind: "workspace", workspace, actor: actor.data };
}
