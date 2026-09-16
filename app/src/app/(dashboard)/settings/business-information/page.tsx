"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusinessInformation, UpdateBusinessInformationRequest } from "@drezivo/contracts";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/permissions";
import { useStaffRole } from "@/lib/use-staff-role";

export default function BusinessInformationPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const staffRole = useStaffRole();
  const canEdit = Boolean(staffRole) && can({ role: staffRole as NonNullable<typeof staffRole> }, "settings.policies.edit");

  const { data: business, isPending, isError, error } = useQuery({
    queryKey: ["business-information", organization?.id],
    queryFn: () => api.get<BusinessInformation>("/settings/business-information"),
    enabled: Boolean(organization),
  });

  const [form, setForm] = useState<UpdateBusinessInformationRequest | null>(null);

  useEffect(() => {
    if (business) {
      setForm({
        businessName: business.businessName,
        contactPhone: business.contactPhone,
        address: business.address,
        cancellationPolicy: business.cancellationPolicy,
        paymentInstructions: business.paymentInstructions,
        version: business.version,
      });
    }
  }, [business]);

  const { submit, isPending: isSaving, error: saveError, resetIntent } = useSubmitGuard(
    async (idempotencyKey: string) => {
      if (!form) throw new Error("Nothing to save yet.");
      return api.patch("/settings/business-information", form, idempotencyKey);
    }
  );

  function updateField<K extends keyof UpdateBusinessInformationRequest>(key: K, value: UpdateBusinessInformationRequest[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    resetIntent();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = await submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["business-information"] });
  }

  if (isPending) return <Skeleton className="h-96 w-full" label="Loading business information" />;
  if (isError || !business || !form) {
    return (
      <EmptyState
        heading="Couldn't load business information"
        description={error instanceof Error ? error.message : "Try refreshing the page."}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-ink-500">
        This policy and contact information is what guests see before checkout, and is snapshotted onto every
        reservation at the time it&apos;s made (TRD §5) — editing it never rewrites an accepted rental.
      </p>

      <Input
        label="Business name"
        value={form.businessName}
        disabled={!canEdit || isSaving}
        onChange={(event) => updateField("businessName", event.target.value)}
      />
      <Input
        label="Contact phone"
        value={form.contactPhone}
        disabled={!canEdit || isSaving}
        onChange={(event) => updateField("contactPhone", event.target.value)}
      />
      <Input
        label="Branch address"
        value={form.address}
        disabled={!canEdit || isSaving}
        onChange={(event) => updateField("address", event.target.value)}
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-700">Cancellation policy</span>
        <textarea
          value={form.cancellationPolicy}
          disabled={!canEdit || isSaving}
          onChange={(event) => updateField("cancellationPolicy", event.target.value)}
          rows={4}
          className="rounded-md border border-ink-300 px-3 py-2 text-sm disabled:bg-ink-100"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-700">Payment instructions</span>
        <textarea
          value={form.paymentInstructions}
          disabled={!canEdit || isSaving}
          onChange={(event) => updateField("paymentInstructions", event.target.value)}
          rows={4}
          className="rounded-md border border-ink-300 px-3 py-2 text-sm disabled:bg-ink-100"
        />
      </label>

      {!canEdit && <p className="text-sm text-ink-500">Front desk has read-only access to policies (PRD §5).</p>}

      {saveError && (
        <p role="alert" className="text-sm text-danger-500">
          {saveError instanceof ApiError ? saveError.message : "Something went wrong. Try again."}
        </p>
      )}

      {canEdit && (
        <div>
          <Button type="submit" isPending={isSaving} pendingLabel="Saving…">
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
