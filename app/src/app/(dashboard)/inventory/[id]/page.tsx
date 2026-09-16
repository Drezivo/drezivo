"use client";

import { useParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { PhysicalAssetDetail } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhp } from "@/lib/money";

export default function InventoryDetailPage() {
  const params = useParams<{ id: string }>();
  const { organization } = useOrganization();
  const api = useApiClient();

  const { data: asset, isPending, isError, error } = useQuery({
    queryKey: ["inventory", "detail", params.id],
    queryFn: () => api.get<PhysicalAssetDetail>(`/catalogue/assets/${params.id}`),
    enabled: Boolean(organization) && Boolean(params.id),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" label="Loading asset" />
        <Skeleton className="h-56 w-full" label="Loading asset details" />
      </div>
    );
  }

  if (isError || !asset) {
    return (
      <EmptyState
        heading="Couldn't load this item"
        description={error instanceof Error ? error.message : "It may not exist, or you may not have access to it."}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            {asset.styleName} — {asset.variantLabel}
          </h1>
          <p className="text-sm text-ink-500">Asset {asset.assetCode}</p>
        </div>
        <Badge tone={asset.condition === "ready" ? "success" : "warning"}>{asset.condition.replace("_", " ")}</Badge>
      </div>

      <section className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border border-ink-300 bg-white p-6 text-sm">
        <div>
          <dt className="text-ink-500">Category</dt>
          <dd className="text-ink-900">{asset.categoryName}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Location</dt>
          <dd className="text-ink-900">{asset.location}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Rental price</dt>
          <dd className="text-ink-900">{formatPhp(asset.rentalAmount)}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Security deposit</dt>
          <dd className="text-ink-900">{formatPhp(asset.depositAmount)}</dd>
        </div>
        {asset.measurements.map((measurement) => (
          <div key={measurement.label}>
            <dt className="text-ink-500">{measurement.label}</dt>
            <dd className="text-ink-900">{measurement.value}</dd>
          </div>
        ))}
      </section>

      {asset.alterationNote && (
        <section className="rounded-lg border border-ink-300 bg-white p-4 text-sm">
          <h2 className="mb-1 font-medium text-ink-900">Alteration note</h2>
          <p className="text-ink-700">{asset.alterationNote}</p>
        </section>
      )}
    </div>
  );
}
