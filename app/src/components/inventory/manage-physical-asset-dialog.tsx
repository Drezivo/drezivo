"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Package, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { PhysicalAssetSummary, UpdatePhysicalAssetStateResponse } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

const READINESS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "needs_cleaning", label: "Needs cleaning" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "unready", label: "Unready / needs review" },
] as const;

type AssetReadiness = PhysicalAssetSummary["readiness"];

export function ManagePhysicalAssetDialog({
  asset,
  onOpenChange,
  onUpdated,
  open,
  sizeLabel,
}: {
  asset: PhysicalAssetSummary | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (result: UpdatePhysicalAssetStateResponse) => void;
  open: boolean;
  sizeLabel: string | null;
}) {
  const { getToken } = useAuth();
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [readiness, setReadiness] = useState<AssetReadiness>("unready");
  const [conditionNote, setConditionNote] = useState("");
  const [error, setError] = useState<DrezivoApiError | null>(null);

  useEffect(() => {
    if (!asset) return;
    setReadiness(asset.readiness);
    setConditionNote(asset.condition_note ?? "");
    setError(null);
    resetIntent();
  }, [asset, resetIntent]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) {
      setError(null);
      resetIntent();
    }
    onOpenChange(nextOpen);
  };

  const save = async () => {
    if (!asset || isSubmitting) return;
    setError(null);

    const normalizedConditionNote = conditionNote.trim();
    const currentConditionNote = (asset.condition_note ?? "").trim();
    const result = await submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).updatePhysicalAssetState(
        asset.id,
        {
          expected_version: asset.version,
          ...(readiness !== asset.readiness ? { readiness } : {}),
          ...(normalizedConditionNote !== currentConditionNote
            ? { condition_note: normalizedConditionNote || null }
            : {}),
        },
        idempotencyKey
      )
    ).catch((caughtError: unknown) => {
      setError(toDrezivoApiError(caughtError));
      return undefined;
    });

    if (!result) return;
    onUpdated(result.data);
    onOpenChange(false);
  };

  const readinessLocked = asset?.lifecycle_status !== "active";
  const readyBlockedByCustody = asset?.custody_kind !== "at_branch";
  const hasChanges = Boolean(
    asset &&
    (readiness !== asset.readiness || conditionNote.trim() !== (asset.condition_note ?? "").trim())
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
                <Package className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                  Manage physical piece
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                  Update the live readiness of this serialized garment. This affects operational
                  pickup readiness, not catalogue pricing or reservation snapshots.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close physical piece dialog"
                disabled={isSubmitting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {asset ? (
            <>
              <div className="mt-5 grid gap-3 rounded-lg border border-dashboard-border bg-dashboard-canvas/60 p-3 text-sm sm:grid-cols-2">
                <AssetFact label="Piece" value={asset.asset_code} />
                <AssetFact label="Size" value={sizeLabel ?? "—"} />
                <AssetFact label="Lifecycle" value={labelize(asset.lifecycle_status)} />
                <AssetFact label="Custody" value={labelize(asset.custody_kind)} />
              </div>

              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Readiness
                  </span>
                  <select
                    aria-label="Readiness"
                    value={readiness}
                    disabled={isSubmitting || readinessLocked}
                    onChange={(event) => {
                      resetIntent();
                      setError(null);
                      setReadiness(event.target.value as AssetReadiness);
                    }}
                    className="h-10 w-full rounded-md border border-dashboard-border bg-dashboard-canvas px-3 text-sm text-dashboard-navy outline-none transition-colors focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {READINESS_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={option.value === "ready" && readyBlockedByCustody}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {readinessLocked ? (
                  <p className="text-xs leading-5 text-dashboard-muted">
                    Readiness cannot be changed while this piece is{" "}
                    {labelize(asset.lifecycle_status).toLowerCase()}.
                  </p>
                ) : readyBlockedByCustody ? (
                  <p className="text-xs leading-5 text-dashboard-muted">
                    This piece is not currently at the branch, so it cannot be marked Ready yet.
                  </p>
                ) : null}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Condition note (optional)
                  </span>
                  <textarea
                    aria-label="Condition note"
                    rows={4}
                    maxLength={2000}
                    value={conditionNote}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      resetIntent();
                      setError(null);
                      setConditionNote(event.target.value);
                    }}
                    placeholder="e.g. Cleaned, steamed, and ready for pickup."
                    className="w-full resize-y rounded-md border border-dashboard-border bg-dashboard-canvas px-3 py-2 text-sm text-dashboard-navy outline-none transition-colors placeholder:text-dashboard-muted focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger"
                >
                  <p>{assetStateErrorMessage(error)}</p>
                  {error.requestId ? (
                    <p className="mt-1 text-xs opacity-80">Support reference: {error.requestId}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" disabled={isSubmitting}>
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  type="button"
                  disabled={isSubmitting || !hasChanges}
                  onClick={() => void save()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {isSubmitting ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function physicalAssetUpdateSuccessMessage(
  result: UpdatePhysicalAssetStateResponse
): string {
  const readinessLabel = labelize(result.asset.readiness);
  if (result.disruptions_created > 0) {
    const count = result.disruptions_created;
    return `${result.asset.asset_code} is now ${readinessLabel}. ${count} future reservation ${count === 1 ? "needs" : "need"} attention.`;
  }
  return `${result.asset.asset_code} is now ${readinessLabel}.`;
}

function AssetFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-dashboard-muted">{label}</p>
      <p className="mt-0.5 font-medium text-dashboard-navy">{value}</p>
    </div>
  );
}

function assetStateErrorMessage(error: DrezivoApiError): string {
  if (error.code === "STALE_VERSION") {
    return "This physical piece changed since you opened it. Close this dialog, refresh the clothing details, and try again.";
  }
  return error.message;
}

function labelize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("Could not update this physical piece. Please try again.", {
    status: 500,
  });
}
