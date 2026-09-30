"use client";

import type { ActorContext, WorkspaceSummary } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

type SetActiveOrganization = (params: { organization: string | null }) => Promise<unknown>;

export type StaffLandingResolution =
  | { kind: "workspace"; workspace: WorkspaceSummary; actor: ActorContext }
  | { kind: "onboarding" };

const SET_ACTIVE_TIMEOUT_MS = 10_000;

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
}: {
  activeOrganizationId: string | null | undefined;
  getToken: () => Promise<string | null>;
  setActive: SetActiveOrganization;
}): Promise<StaffLandingResolution> {
  const api = createDrezivoApiClient(getToken);
  const workspaces = await api.getWorkspaces();

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
