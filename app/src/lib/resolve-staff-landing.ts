"use client";

import type { WorkspaceSummary } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

type SetActiveOrganization = (params: { organization: string | null }) => Promise<unknown>;

export type StaffLandingResolution =
  | { kind: "workspace"; workspace: WorkspaceSummary }
  | { kind: "onboarding" };

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
      await setActive({ organization: null });
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
    await setActive({ organization: workspace.clerk_org_id });
  }

  const actor = await api.getActorContext();
  if (actor.data.tenant.id !== workspace.tenant.id) {
    throw new DrezivoApiError(
      "Your active workspace did not match the workspace assigned to this account.",
      { status: 409 }
    );
  }

  return { kind: "workspace", workspace };
}
