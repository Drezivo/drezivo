"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ActorContext } from "@drezivo/contracts";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { WorkspaceOpening } from "@/components/auth/workspace-opening";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { invitationStateOf, resolveStaffLanding } from "@/lib/resolve-staff-landing";
import { takeResolvedWorkspace } from "@/lib/workspace-handoff";

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
const ACTOR_REFRESH_INTERVAL_MS = 30_000;

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
  const identityRef = useRef({ orgId, isSignedIn });
  const refreshVersion = useRef(0);
  identityRef.current = { orgId, isSignedIn };

  useEffect(() => () => { refreshVersion.current += 1; }, [orgId, isSignedIn]);

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
      // Straight after sign-in the resolver already chose and activated this workspace; only the
      // actor context (authorized by the API) is still needed.
      if (takeResolvedWorkspace(orgId)) {
        const actor = await createDrezivoApiClient(() => getTokenRef.current()).getActorContext();
        setState({ kind: "ready", actor: actor.data });
        return;
      }
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
    const identity = identityRef.current;
    if (!identity.isSignedIn) return Promise.resolve();
    const version = ++refreshVersion.current;
    return createDrezivoApiClient(() => getTokenRef.current())
      .getActorContext()
      .then((result) => {
        if (version !== refreshVersion.current || !identityRef.current.isSignedIn || identityRef.current.orgId !== identity.orgId) return;
        setState((current) => current.kind === "ready" && current.actor?.tenant.id === result.data.tenant.id
          ? { kind: "ready", actor: result.data }
          : current);
      })
      .catch(() => undefined);
  }, []);

  const ready = state.kind === "ready";
  useEffect(() => {
    if (!ready || !isSignedIn) return;
    let refreshPending = false;
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible" || refreshPending) return;
      refreshPending = true;
      void refreshActor().finally(() => { refreshPending = false; });
    };
    const timer = window.setInterval(refreshIfVisible, ACTOR_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [ready, isSignedIn, refreshActor]);

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

  if (state.kind === "checking") return <WorkspaceOpening />;

  return (
    <main className="flex min-h-svh items-center justify-center bg-dashboard-canvas px-5 py-10 text-dashboard-navy sm:px-8">
      <section
        className="w-full max-w-lg rounded-2xl border border-dashboard-border bg-dashboard-surface p-7 shadow-sm sm:p-9"
        role="alert"
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
