"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { Loader2, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import type { UpdateClothingVariantLifecycleResponse } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

export function RestoreClothingVariantDialog({
  onOpenChange,
  onRestored,
  open,
  productId,
  variant,
  variantLabel,
}: {
  onOpenChange: (open: boolean) => void;
  onRestored: (result: UpdateClothingVariantLifecycleResponse) => void;
  open: boolean;
  productId: string;
  variant: { id: string; updated_at: string } | null;
  variantLabel: string;
}) {
  const { getToken } = useAuth();
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [error, setError] = useState<DrezivoApiError | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    setError(null);
    resetIntent();
    onOpenChange(nextOpen);
  };

  const restore = async () => {
    if (isSubmitting || !variant) return;
    setError(null);
    const result = await submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).updateClothingVariantLifecycle(
        productId,
        variant.id,
        { expected_updated_at: variant.updated_at, status: "active" },
        idempotencyKey
      )
    ).catch((caughtError: unknown) => {
      setError(toVariantRestoreError(caughtError));
      return undefined;
    });
    if (!result) return;
    onRestored(result.data);
    onOpenChange(false);
  };

  if (!variant) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
                <RotateCcw className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                  Restore size {variantLabel}?
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                  This size will return to Variants &amp; Pricing as active and may be considered
                  for future rentals. Each piece keeps its current lifecycle, readiness, custody,
                  and allocation state.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close restore size dialog"
                disabled={isSubmitting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger"
            >
              <p>{variantRestoreErrorMessage(error)}</p>
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
            <Button type="button" disabled={isSubmitting} onClick={() => void restore()}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Restoring…" : "Restore size"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toVariantRestoreError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("Could not restore this size. Please try again.", { status: 500 });
}

function variantRestoreErrorMessage(error: DrezivoApiError): string {
  if (error.code === "STALE_VERSION") {
    return "This size changed since it was loaded. Refresh the clothing details before restoring.";
  }
  return error.message;
}
