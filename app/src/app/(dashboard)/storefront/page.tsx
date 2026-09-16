"use client";

import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublishStorefrontRequest, PublishStorefrontResponse, StorefrontSettings } from "@drezivo/contracts";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/permissions";
import { useStaffRole } from "@/lib/use-staff-role";

export default function StorefrontPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const staffRole = useStaffRole();

  const { data: storefront, isPending, isError, error } = useQuery({
    queryKey: ["storefront", organization?.id],
    queryFn: () => api.get<StorefrontSettings>("/storefront"),
    enabled: Boolean(organization),
  });

  const { submit, isPending: isPublishing, error: publishError } = useSubmitGuard(
    async (idempotencyKey: string) => {
      if (!storefront) throw new Error("Storefront not loaded yet.");
      const body: PublishStorefrontRequest = { storefrontVersion: storefront.version };
      return api.post<PublishStorefrontResponse>("/storefront/publish", body, idempotencyKey);
    }
  );

  const canPublish = Boolean(staffRole) && can({ role: staffRole as NonNullable<typeof staffRole> }, "storefront.publish");

  async function handlePublish() {
    const result = await submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["storefront"] });
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" label="Loading storefront" />
        <Skeleton className="h-56 w-full" label="Loading storefront settings" />
      </div>
    );
  }

  if (isError || !storefront) {
    return (
      <EmptyState
        heading="Couldn't load your storefront"
        description={error instanceof Error ? error.message : "Try refreshing the page."}
      />
    );
  }

  // Publish requires contact, policy, payment instruction, and one active rentable asset
  // (PRD §4 Onboarding/live publish). Surface exactly what's missing instead of a disabled
  // button with no explanation.
  const missing: string[] = [];
  if (!storefront.hasContact) missing.push("business contact details");
  if (!storefront.hasPolicy) missing.push("cancellation policy");
  if (!storefront.hasPaymentInstructions) missing.push("payment instructions");
  if (!storefront.hasActiveAsset) missing.push("at least one active rentable item");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Manage storefront</h1>
          <p className="text-sm text-ink-500">
            What guests see at your public storefront URL. Preview must match exactly what publishes (PRD §4).
          </p>
        </div>
        <Badge tone={storefront.isPublished ? "success" : "neutral"}>
          {storefront.isPublished ? "Published" : "Draft"}
        </Badge>
      </div>

      <section className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border border-ink-300 bg-white p-6 text-sm">
        <div>
          <dt className="text-ink-500">Storefront URL</dt>
          <dd className="text-ink-900">{storefront.previewUrl}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Contact</dt>
          <dd className="text-ink-900">{storefront.hasContact ? "Set" : "Missing"}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Cancellation policy</dt>
          <dd className="text-ink-900">{storefront.hasPolicy ? "Set" : "Missing"}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Payment instructions</dt>
          <dd className="text-ink-900">{storefront.hasPaymentInstructions ? "Set" : "Missing"}</dd>
        </div>
      </section>

      {missing.length > 0 && (
        <section className="rounded-lg border border-warning-500/30 bg-warning-500/5 p-4 text-sm text-ink-700">
          Before you can publish, add: {missing.join(", ")}.
        </section>
      )}

      {publishError && (
        <p role="alert" className="text-sm text-danger-500">
          {publishError instanceof ApiError ? publishError.message : "Something went wrong. Try again."}
        </p>
      )}

      {canPublish ? (
        <div>
          <Button onClick={handlePublish} isPending={isPublishing} pendingLabel="Publishing…" disabled={missing.length > 0}>
            {storefront.isPublished ? "Republish changes" : "Publish storefront"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-500">Only an Owner can publish the storefront (PRD §5).</p>
      )}
    </div>
  );
}
