"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import type { InventoryListItem, PaginatedResponse } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

const CONDITION_TONE = {
  ready: "success",
  needs_cleaning: "warning",
  in_maintenance: "warning",
  retired: "neutral",
} as const;

export default function InventoryPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const router = useRouter();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["inventory", organization?.id],
    queryFn: () => api.get<PaginatedResponse<InventoryListItem>>("/catalogue/assets"),
    enabled: Boolean(organization),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Inventory</h1>
          <p className="text-sm text-ink-500">
            Physical assets tracked by unique code, condition, and custody. Styles and variants group assets for
            the storefront (PRD §3).
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/categories">
            <Button variant="secondary">Manage categories</Button>
          </Link>
          <Link href="/inventory/new">
            <Button>Add clothing item</Button>
          </Link>
        </div>
      </div>

      {isPending && <TableSkeleton columns={5} />}

      {isError && (
        <EmptyState
          heading="Couldn't load inventory"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          heading="No clothing items yet"
          description="Add your first style and physical asset so guests can book it from your storefront."
          action={
            <Link href="/inventory/new">
              <Button>Add clothing item</Button>
            </Link>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <Table
          caption="Inventory"
          rows={data.items}
          getRowId={(item) => item.assetId}
          onRowClick={(item) => router.push(`/inventory/${item.assetId}`)}
          columns={[
            { key: "code", header: "Asset code", render: (item) => <span className="font-medium">{item.assetCode}</span> },
            { key: "style", header: "Style", render: (item) => item.styleName },
            { key: "variant", header: "Variant", render: (item) => item.variantLabel },
            { key: "category", header: "Category", render: (item) => item.categoryName },
            {
              key: "condition",
              header: "Condition",
              render: (item) => <Badge tone={CONDITION_TONE[item.condition]}>{item.condition.replace("_", " ")}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}
