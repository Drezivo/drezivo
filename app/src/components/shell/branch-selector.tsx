"use client";

import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import type { Branch } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * V1 is single-branch (PRD §1: "Tenant and default branch exist from account creation").
 * This still queries /branches and renders a real <select>, rather than hard-coding the
 * default branch's name, so V2 multi-branch support is additive here instead of requiring
 * a rewrite of the shell.
 */
export function BranchSelector() {
  const { organization } = useOrganization();
  const api = useApiClient();

  const { data: branches, isPending, isError } = useQuery({
    queryKey: ["branches", organization?.id],
    queryFn: () => api.get<Branch[]>("/branches"),
    enabled: Boolean(organization),
  });

  if (isPending) {
    return <Skeleton className="h-9 w-40" label="Loading branches" />;
  }

  if (isError || !branches || branches.length === 0) {
    // A tenant always has a default branch (PRD §1); an empty/error result here means the
    // request itself failed, not that branches are legitimately absent. Fail visibly.
    return <span className="text-xs text-danger-500">Branch unavailable</span>;
  }

  return (
    <label className="flex items-center gap-2 text-sm text-ink-700">
      <span className="sr-only">Active branch</span>
      <select
        defaultValue={branches[0]?.id}
        disabled={branches.length <= 1}
        className="rounded-md border border-ink-300 bg-white px-2 py-1.5 text-sm disabled:bg-ink-100"
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
