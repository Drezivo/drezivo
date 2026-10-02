"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { Archive, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { ArchiveClothingResponse } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

export function ArchiveClothingDialog({
  name,
  onArchived,
  onOpenChange,
  open,
  productId,
  updatedAt,
}: {
  name: string;
  onArchived: (result: ArchiveClothingResponse) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  productId: string;
  updatedAt: string;
}) {
  const { getToken } = useAuth();
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [error, setError] = useState<DrezivoApiError | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (nextOpen) {
      setError(null);
      resetIntent();
    } else {
      setError(null);
      resetIntent();
    }
    onOpenChange(nextOpen);
  };

  const archive = async () => {
    if (isSubmitting) return;
    setError(null);

    const result = await submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).archiveClothing(
        productId,
        { expected_updated_at: updatedAt },
        idempotencyKey
      )
    ).catch((caughtError: unknown) => {
      setError(toDrezivoApiError(caughtError));
      return undefined;
    });

    if (!result) return;
    onArchived(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-danger/10 text-dashboard-danger">
                <Archive className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                  Archive {name}?
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                  This clothing will stop accepting new rentals. Existing reservations, allocations,
                  and rental history stay intact. Physical pieces are retired only when it is safe.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close archive dialog"
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
              <p>{archiveErrorMessage(error)}</p>
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
              disabled={isSubmitting}
              onClick={() => void archive()}
              className="bg-dashboard-danger text-dashboard-primary-ink hover:bg-dashboard-danger/90"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Archive className="h-4 w-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Archiving…" : "Archive Clothing"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function archiveSuccessMessage(result: ArchiveClothingResponse): string {
  if (result.pending_asset_resolution_count > 0) {
    const count = result.pending_asset_resolution_count;
    return `Clothing archived. ${count} physical ${count === 1 ? "piece still requires" : "pieces still require"} operational resolution.`;
  }
  return "Clothing archived.";
}

function archiveErrorMessage(error: DrezivoApiError): string {
  if (error.code === "STALE_VERSION") {
    return "This clothing changed since you opened it. Refresh the latest version before archiving.";
  }
  return error.message;
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("Could not archive this clothing. Please try again.", { status: 500 });
}
