"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences, UpdateNotificationPreferencesRequest } from "@drezivo/contracts";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const TOGGLES: Array<{ key: keyof UpdateNotificationPreferencesRequest; label: string; description: string }> = [
  { key: "notifyOnHoldCreated", label: "New hold created", description: "A guest starts checkout and holds a garment." },
  { key: "notifyOnEvidenceSubmitted", label: "Payment evidence submitted", description: "Cash or QR evidence is ready for your review." },
  { key: "notifyOnHoldExpiringSoon", label: "Hold expiring soon", description: "Warn before an unpaid hold releases its garment (PRD §3)." },
  { key: "notifyOnOverdueReturn", label: "Overdue return", description: "A picked-up rental has passed its due time." },
];

export default function NotificationSettingsPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const { data: preferences, isPending, isError, error } = useQuery({
    queryKey: ["notification-preferences", organization?.id],
    queryFn: () => api.get<NotificationPreferences>("/settings/notifications"),
    enabled: Boolean(organization),
  });

  const [form, setForm] = useState<UpdateNotificationPreferencesRequest | null>(null);

  useEffect(() => {
    if (preferences) {
      setForm({
        notifyOnHoldCreated: preferences.notifyOnHoldCreated,
        notifyOnEvidenceSubmitted: preferences.notifyOnEvidenceSubmitted,
        notifyOnHoldExpiringSoon: preferences.notifyOnHoldExpiringSoon,
        notifyOnOverdueReturn: preferences.notifyOnOverdueReturn,
        version: preferences.version,
      });
    }
  }, [preferences]);

  const { submit, isPending: isSaving, error: saveError, resetIntent } = useSubmitGuard(
    async (idempotencyKey: string) => {
      if (!form) throw new Error("Nothing to save yet.");
      return api.patch("/settings/notifications", form, idempotencyKey);
    }
  );

  function toggle(key: keyof UpdateNotificationPreferencesRequest) {
    setForm((current) => (current ? { ...current, [key]: !current[key] } : current));
    resetIntent();
  }

  async function handleSave() {
    const result = await submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
  }

  if (isPending) return <Skeleton className="h-64 w-full" label="Loading notification preferences" />;
  if (isError || !preferences || !form) {
    return (
      <EmptyState
        heading="Couldn't load notification preferences"
        description={error instanceof Error ? error.message : "Try refreshing the page."}
      />
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-ink-500">
        Notifications are queued and delivered asynchronously (TRD §8) — turning one off stops future sends, it
        doesn&apos;t cancel anything already queued.
      </p>

      <ul className="flex flex-col gap-3 rounded-lg border border-ink-300 bg-white p-4">
        {TOGGLES.map((item) => (
          <li key={item.key} className="flex items-start justify-between gap-4 border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
            <div>
              <p className="text-sm font-medium text-ink-900">{item.label}</p>
              <p className="text-xs text-ink-500">{item.description}</p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(form[item.key])}
              onChange={() => toggle(item.key)}
              disabled={isSaving}
              aria-label={item.label}
              className="mt-1 h-4 w-4"
            />
          </li>
        ))}
      </ul>

      {saveError && (
        <p role="alert" className="text-sm text-danger-500">
          {saveError instanceof ApiError ? saveError.message : "Something went wrong. Try again."}
        </p>
      )}

      <div>
        <Button onClick={handleSave} isPending={isSaving} pendingLabel="Saving…">
          Save changes
        </Button>
      </div>
    </div>
  );
}
