"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import type { ActorContext } from "@drezivo/contracts";
import { useEffect } from "react";
import { useApiClient } from "@/lib/api-client";
import { useWorkspace } from "@/lib/workspace-context";
import { Skeleton } from "@/components/ui/skeleton";

/** Branch selection is a verified selector; the API checks the active branch grant. */
export function BranchSelector() {
  const { orgId, userId } = useAuth();
  const api = useApiClient();
  const { activeBranchId, setActiveBranchId } = useWorkspace();

  const {
    data: context,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["actor-context", userId, orgId, activeBranchId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get<ActorContext>("/actor-context", signal),
    enabled: Boolean(userId && orgId),
  });

  useEffect(() => {
    if (context && !activeBranchId) setActiveBranchId(context.active_branch_id);
  }, [context, activeBranchId, setActiveBranchId]);

  if (isPending) {
    return <Skeleton className="h-9 w-40" label="Loading branches" />;
  }

  if (isError || !context || context.branches.length === 0) {
    return <span className="text-xs text-danger-500">Branch unavailable</span>;
  }

  return (
    <label className="flex items-center gap-2 text-sm text-ink-700">
      <span className="sr-only">Active branch</span>
      <select
        value={context.active_branch_id}
        onChange={(event) => setActiveBranchId(event.target.value)}
        disabled={context.branches.length <= 1}
        className="rounded-md border border-ink-300 bg-white px-2 py-1.5 text-sm disabled:bg-ink-100"
      >
        {context.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
