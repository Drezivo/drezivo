"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import type { WorkspaceList } from "@drezivo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { useApiClient } from "@/lib/api-client";
import { useWorkspace } from "@/lib/workspace-context";
import { Skeleton } from "@/components/ui/skeleton";

/** Local Drezivo workspace authority. Clerk only receives the selected opaque organization ID. */
export function WorkspaceSwitcher() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { orgId, userId } = useAuth();
  const { setActive } = useOrganizationList();
  const { setActiveBranchId } = useWorkspace();
  const workspaces = useQuery({
    queryKey: ["workspaces", userId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get<WorkspaceList>("/workspaces", signal),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  if (workspaces.isPending) return <Skeleton className="h-9 w-full" label="Loading workspaces" />;
  if (workspaces.isError)
    return <span className="text-xs text-danger-500">Workspace unavailable</span>;
  if (!workspaces.data || workspaces.data.items.length === 0) {
    return (
      <Link
        className="rounded-md border border-brand-300 px-3 py-2 text-sm text-brand-700"
        href="/onboarding"
      >
        Set up your workspace
      </Link>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-500">
      <span>Workspace</span>
      <select
        value={orgId ?? ""}
        onChange={(event) => {
          const nextOrgId = event.target.value;
          if (!nextOrgId || !setActive) return;
          setActiveBranchId(null);
          void queryClient.cancelQueries();
          void setActive({ organization: nextOrgId }).then(() => {
            void queryClient.invalidateQueries();
          });
        }}
        className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-sm text-ink-900"
      >
        <option value="" disabled>
          Select a workspace
        </option>
        {workspaces.data.items.map((workspace) => (
          <option key={workspace.tenant.id} value={workspace.clerk_org_id}>
            {workspace.tenant.name} ({workspace.role})
            {workspace.tenant.status !== "active" ? ` — ${workspace.tenant.status}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
