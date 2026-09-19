"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AuthBrand } from "@/components/auth/auth-brand";
import { DrezivoApiError } from "@/lib/drezivo-api";
import { resolveStaffLanding } from "@/lib/resolve-staff-landing";

type ResolveState =
  | { kind: "resolving" }
  | { kind: "error"; error: DrezivoApiError };

export function PostAuthResolver() {
  const { getToken, isLoaded, isSignedIn, orgId } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<ResolveState>({ kind: "resolving" });

  const resolveLanding = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }

    setState({ kind: "resolving" });
    try {
      const resolution = await resolveStaffLanding({
        activeOrganizationId: orgId,
        getToken,
        setActive,
      });
      router.replace(resolution.kind === "workspace" ? "/" : "/onboarding");
    } catch (error) {
      setState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [getToken, isLoaded, isSignedIn, orgId, router, setActive]);

  useEffect(() => {
    void resolveLanding();
  }, [resolveLanding]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-auth-night px-6 text-auth-text">
      <section className="w-full max-w-md text-center" aria-live="polite">
        <AuthBrand />
        {state.kind === "resolving" ? (
          <>
            <div className="mx-auto mt-10 h-10 w-10 animate-spin rounded-full border-2 border-auth-line border-t-auth-gold" />
            <h1 className="mt-7 font-display text-3xl">Opening your workspace</h1>
            <p className="mt-3 text-sm leading-6 text-auth-dark-muted">
              We&apos;re checking your Drezivo access and setup.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-10 font-display text-3xl">We could not resolve your workspace</h1>
            <p className="mt-3 text-sm leading-6 text-auth-dark-muted">{state.error.message}</p>
            {state.error.requestId ? (
              <p className="mt-2 text-xs text-auth-dark-muted">
                Support reference: {state.error.requestId}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void resolveLanding()}
              className="mt-7 inline-flex min-h-10 items-center justify-center rounded-full bg-auth-button px-6 text-sm font-semibold text-auth-button-ink transition hover:bg-auth-button-hover"
            >
              Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not resolve your account access. Please try again.", {
    status: 500,
  });
}
