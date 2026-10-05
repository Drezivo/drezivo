"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthBrand } from "@/components/auth/auth-brand";
import { DrezivoApiError } from "@/lib/drezivo-api";
import { invitationStateOf, resolveStaffLanding } from "@/lib/resolve-staff-landing";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

type ResolveState =
  | { kind: "resolving" }
  | { kind: "error"; error: DrezivoApiError };

const RESOLVE_TIMEOUT_MS = 20_000;

export function PostAuthResolver() {
  const { getToken, isLoaded, isSignedIn, orgId } = useAuth();
  const { setActive, user } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<ResolveState>({ kind: "resolving" });
  // Clerk updates orgId and getToken while it finishes sign-in and while setActive runs. Read them
  // through refs so those updates do not start a second, overlapping resolution.
  const latest = useRef({ getToken, orgId, setActive, user });
  latest.current = { getToken, orgId, setActive, user };
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    if (started.current) return;
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new DrezivoApiError("Opening your workspace took too long. Please try again.", { status: 504 })),
        RESOLVE_TIMEOUT_MS
      );
    });
    const { getToken: token, orgId: activeOrganizationId, setActive: activate, user: signedInUser } = latest.current;

    Promise.race([resolveStaffLanding({
        activeOrganizationId,
        getToken: token,
        setActive: activate,
        invitations: invitationStateOf(signedInUser),
      }), timeout])
      .then((resolution) => {
        // A full navigation, not router.replace: Clerk refreshes the router right after sign-in, and
        // that refresh cancelled the soft navigation, leaving this spinner up until a manual reload.
        // replace() also keeps this page out of history, so Back does not return to it.
        window.location.replace(resolution.kind === "workspace" ? WORKSPACE_HOME : "/onboarding");
      })
      .catch((error: unknown) => setState({ kind: "error", error: toDrezivoApiError(error) }))
      .finally(() => clearTimeout(timer));
  }, [isLoaded, isSignedIn, router]);

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
              onClick={() => window.location.reload()}
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
