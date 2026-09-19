"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DrezivoApiError } from "@/lib/drezivo-api";
import { resolveStaffLanding } from "@/lib/resolve-staff-landing";

type GateState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "error"; error: DrezivoApiError };

export function DashboardAccessGate({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, orgId } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<GateState>({ kind: "checking" });

  const verifyAccess = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }

    setState({ kind: "checking" });
    try {
      const resolution = await resolveStaffLanding({
        activeOrganizationId: orgId,
        getToken,
        setActive,
      });
      if (resolution.kind === "onboarding") {
        router.replace("/onboarding");
        return;
      }
      setState({ kind: "ready" });
    } catch (error) {
      setState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [getToken, isLoaded, isSignedIn, orgId, router, setActive]);

  useEffect(() => {
    void verifyAccess();
  }, [verifyAccess]);

  if (state.kind === "ready") return <>{children}</>;

  return (
    <main className="flex min-h-svh items-center justify-center bg-dashboard-canvas px-6 text-dashboard-navy">
      {state.kind === "checking" ? (
        <div className="text-center" aria-live="polite">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-dashboard-border border-t-dashboard-accent" />
          <p className="mt-4 text-sm text-dashboard-muted">Checking workspace access…</p>
        </div>
      ) : (
        <section className="w-full max-w-md text-center" role="alert">
          <h1 className="font-display text-3xl">Workspace access needs attention</h1>
          <p className="mt-3 text-sm leading-6 text-dashboard-muted">{state.error.message}</p>
          {state.error.requestId ? (
            <p className="mt-2 text-xs text-dashboard-muted">
              Support reference: {state.error.requestId}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void verifyAccess()}
            className="mt-6 inline-flex min-h-10 items-center justify-center rounded-full bg-dashboard-accent px-6 text-sm font-semibold text-dashboard-surface"
          >
            Try again
          </button>
        </section>
      )}
    </main>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not verify your workspace access. Please try again.", {
    status: 500,
  });
}
