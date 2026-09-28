"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { CustomerListItem } from "@drezivo/contracts";
import { Archive, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ArchiveCustomerDialog({
  customer,
  isSubmitting,
  mutationError,
  onArchive,
  onOpenChange,
  requestId,
}: {
  customer: CustomerListItem | null;
  isSubmitting: boolean;
  mutationError?: string | null;
  onArchive: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  requestId?: string | null;
}) {
  return (
    <Dialog.Root open={customer !== null} onOpenChange={(open: boolean) => !isSubmitting && onOpenChange(open)}>
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
                  Archive {customer?.full_name ?? "customer"}?
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                  Reservation and fitting history will remain unchanged. This customer will no longer be selectable for new bookings.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close archive customer dialog"
                disabled={isSubmitting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {mutationError ? (
            <div role="alert" className="mt-5 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">
              {mutationError}
              {requestId ? <p className="mt-1 text-xs">Request ID: {requestId}</p> : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" disabled={isSubmitting}>Cancel</Button>
            </Dialog.Close>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => void onArchive()}
              className="bg-dashboard-danger text-white hover:bg-dashboard-danger/90"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? "Archiving…" : "Archive Customer"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
