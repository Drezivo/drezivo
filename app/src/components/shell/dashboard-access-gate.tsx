"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ActorContext } from "@drezivo/contracts";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { invitationStateOf, resolveStaffLanding } from "@/lib/resolve-staff-landing";

type GateState =
  | { kind: "checking" }
  | { kind: "ready"; actor: ActorContext }
  | { kind: "error"; error: DrezivoApiError };

/** The actor context the gate already loaded, so the shell does not fetch it a second time. */
const VerifiedActorContext = createContext<{ actor: ActorContext; refresh: () => void } | null>(
  null
);

export function useVerifiedActorContext(): ActorContext | null {
  return useContext(VerifiedActorContext)?.actor ?? null;
}

/** Re-reads the actor context without showing the access check again (e.g. after a payment is sent). */
export function useRefreshVerifiedActor(): () => void {
  return useContext(VerifiedActorContext)?.refresh ?? noop;
}

const noop = () => undefined;

export function DashboardAccessGate({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, orgId } = useAuth();
  const { setActive, signOut, user } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const signOutInFlight = useRef(false);
  const getTokenRef = useRef(getToken);
  const setActiveRef = useRef(setActive);
  const userRef = useRef(user);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    setActiveRef.current = setActive;
  }, [setActive]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
        getToken: () => getTokenRef.current(),
        setActive: (params) => setActiveRef.current({ ...params, navigate: async () => undefined }),
        invitations: invitationStateOf(userRef.current),
      });
      if (resolution.kind === "workspaces") {
        router.replace("/workspaces/select");
        return;
      }
      if (resolution.kind === "invitation-required") {
        throw new DrezivoApiError(
          "This account has a pending team invitation. Open the invitation link from your email to join that workspace.",
          { status: 409 }
        );
      }
      if (resolution.kind === "onboarding") {
        router.replace("/onboarding");
        return;
      }
      setState({ kind: "ready", actor: resolution.actor });
    } catch (error) {
      setState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [isLoaded, isSignedIn, orgId, router]);

  useEffect(() => {
    void verifyAccess();
  }, [verifyAccess]);

  const refreshActor = useCallback(() => {
    void createDrezivoApiClient(() => getTokenRef.current())
      .getActorContext()
      .then((result) => setState({ kind: "ready", actor: result.data }))
      .catch(() => undefined);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (signOutInFlight.current) return;

    signOutInFlight.current = true;
    setIsSigningOut(true);
    setSignOutError(false);
    try {
      // Clerk clears the active session and redirects to a fresh auth page, which drops this
      // dashboard's in-memory state and any client-side data loaded under the old session.
      await signOut({ redirectUrl: "/sign-in" });
    } catch {
      signOutInFlight.current = false;
      setIsSigningOut(false);
      setSignOutError(true);
    }
  }, [signOut]);

  if (state.kind === "ready") {
    return (
      <VerifiedActorContext.Provider value={{ actor: state.actor, refresh: refreshActor }}>
        {children}
      </VerifiedActorContext.Provider>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-dashboard-canvas px-5 py-10 text-dashboard-navy sm:px-8">
      <section
        className="w-full max-w-lg rounded-2xl border border-dashboard-border bg-dashboard-surface p-7 shadow-sm sm:p-9"
        aria-live="polite"
        {...(state.kind === "error" ? { role: "alert" } : {})}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-dashboard-gold-soft text-dashboard-gold-text">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-dashboard-muted">
              Drezivo workspace
            </p>
            <p className="mt-0.5 text-sm font-medium text-dashboard-navy">Secure access check</p>
          </div>
        </div>

        {state.kind === "checking" ? (
          <div className="mt-8">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-dashboard-accent" aria-hidden="true" />
              <h1 className="font-display text-2xl sm:text-3xl">Opening your workspace</h1>
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-dashboard-muted">
              We&apos;re confirming your account, workspace membership, and current access before
              loading the dashboard.
            </p>
            <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-dashboard-border">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-dashboard-accent" />
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <h1 className="font-display text-2xl sm:text-3xl">Workspace access needs attention</h1>
            <p className="mt-3 text-sm leading-6 text-dashboard-muted">{state.error.message}</p>
            {state.error.requestId ? (
              <p className="mt-3 rounded-md border border-dashboard-border bg-dashboard-canvas px-3 py-2 text-xs text-dashboard-muted">
                Support reference: {state.error.requestId}
              </p>
            ) : null}
            {signOutError ? (
              <p className="mt-4 text-sm text-dashboard-danger" role="status">
                We couldn&apos;t sign you out. Please try again.
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap gap-3">
              <Button disabled={isSigningOut} onClick={() => void verifyAccess()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Check access again
              </Button>
              <Button
                variant="secondary"
                isPending={isSigningOut}
                pendingLabel="Signing out…"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not verify your workspace access. Please try again.", {
    status: 500,
  });
}
