"use client";

import type { ActorContext, WorkspaceSummary } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

type ApiClient = ReturnType<typeof createDrezivoApiClient>;
type SetActiveOrganization = (params: {
  organization: string | null;
  navigate?: () => Promise<unknown>;
}) => Promise<unknown>;

const SET_ACTIVE_TIMEOUT_MS = 10_000;
const WORKSPACE_PAGE_LIMIT = 50;
const MAX_WORKSPACE_PAGES = 20;

export async function listAllAccessibleWorkspaces(api: ApiClient): Promise<WorkspaceSummary[]> {
  const workspaces: WorkspaceSummary[] = [];
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_WORKSPACE_PAGES; pageNumber += 1) {
    const page = await api.getWorkspaces({
      limit: WORKSPACE_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    workspaces.push(...page.data.items);
    if (!page.data.page_meta.has_more) return workspaces;
    if (!page.data.page_meta.next_cursor) break;
    cursor = page.data.page_meta.next_cursor;
  }

  throw new DrezivoApiError("Your workspace list is too large to load. Please contact support.", {
    status: 502,
  });
}

/** Re-authorize the choice from the API, activate Clerk, then verify the API actor context. */
export async function activateAccessibleWorkspace({
  organizationId,
  getToken,
  setActive,
}: {
  organizationId: string;
  getToken: () => Promise<string | null>;
  setActive: SetActiveOrganization;
}): Promise<{ workspace: WorkspaceSummary; actor: ActorContext }> {
  const api = createDrezivoApiClient(getToken);
  const workspaces = await listAllAccessibleWorkspaces(api);
  const workspace = workspaces.find((item) => item.clerk_org_id === organizationId);
  if (!workspace) {
    throw new DrezivoApiError("You do not have access to that workspace.", { status: 403 });
  }

  await withTimeout(
    setActive({
      organization: workspace.clerk_org_id,
      navigate: async () => undefined,
    })
  );
  const actor = (await api.getActorContext()).data;
  if (actor.tenant.id !== workspace.tenant.id || actor.membership.role !== workspace.role) {
    throw new DrezivoApiError(
      "The selected workspace did not match your verified access. Please try again.",
      { status: 409 }
    );
  }

  return { workspace, actor };
}

function withTimeout(promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new DrezivoApiError("Switching workspaces took too long. Please try again.", {
            status: 504,
          })
        ),
      SET_ACTIVE_TIMEOUT_MS
    );
  });

  return Promise.race([promise, timeout])
    .then(() => undefined)
    .finally(() => clearTimeout(timer));
}
