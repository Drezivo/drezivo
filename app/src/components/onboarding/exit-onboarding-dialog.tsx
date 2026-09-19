"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useClerk } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import type { OrganizationOnboarding } from "@drezivo/contracts";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

export function ExitOnboardingDialog({
  getToken,
  onboarding,
}: {
  getToken: () => Promise<string | null>;
  onboarding: OrganizationOnboarding | null;
}) {
  const { signOut } = useClerk();
  const api = createDrezivoApiClient(getToken);
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<DrezivoApiError | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (isSubmitting) return;
    if (nextOpen) {
      resetIntent();
      setError(null);
    }
    setOpen(nextOpen);
  }

  async function handleExit() {
    if (isSubmitting) return;
    setError(null);

    try {
      if (onboarding) {
        const result = await submit((idempotencyKey) =>
          api.abandonOnboarding(onboarding.id, { reason_code: "not_now" }, idempotencyKey)
        );
        if (!result) return;
      }

      await signOut({ redirectUrl: "/sign-in" });
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Leave setup"
          className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-auth-text transition-colors hover:bg-auth-hover focus-visible:bg-auth-hover"
        >
          <ArrowLeft aria-hidden="true" className="h-7 w-7" strokeWidth={1.8} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-auth-page/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-auth-line bg-auth-panel p-6 shadow-2xl outline-none sm:p-7">
          <Dialog.Title className="font-display text-3xl text-auth-text">Leave setup?</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-6 text-auth-dark-muted">
            {onboarding
              ? `Your unfinished setup for ${onboarding.organization_name} will be abandoned. You’ll be signed out, and its temporary organization will be cleaned up.`
              : "You’ll be signed out and can return later to start your business setup."}
          </Dialog.Description>

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error"
            >
              <p>{error.message}</p>
              {error.requestId ? (
                <p className="mt-1 text-xs">Support reference: {error.requestId}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <button type="button" disabled={isSubmitting} className={dialogCancelButtonClass}>
                Keep setting up
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleExit()}
              className={dialogExitButtonClass}
            >
              {isSubmitting ? "Leaving…" : "Leave setup"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not complete that request. Please try again.", {
    status: 500,
  });
}

const dialogCancelButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-auth-line px-5 text-sm font-semibold text-auth-text transition hover:border-auth-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-60";
const dialogExitButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-auth-button px-5 text-sm font-semibold text-auth-button-ink transition hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-60";
