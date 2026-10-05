"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import type { WorkspaceSummary } from "@drezivo/contracts";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthBrand } from "@/components/auth/auth-brand";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { activateAccessibleWorkspace, listAllAccessibleWorkspaces } from "@/lib/workspace-access";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

type ChoiceState =
  | { kind: "loading" }
  | { kind: "ready"; workspaces: WorkspaceSummary[] }
  | { kind: "switching"; workspaces: WorkspaceSummary[]; selectedId: string }
  | { kind: "error"; error: DrezivoApiError };

export function WorkspaceChooser() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<ChoiceState>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    if (started.current) return;
    started.current = true;

    let active = true;
    void listAllAccessibleWorkspaces(createDrezivoApiClient(getToken))
      .then(async (workspaces) => {
        if (!active) return;
        if (workspaces.length === 0) {
          router.replace("/auth/resolve");
          return;
        }
        if (workspaces.length === 1) {
          await activateAccessibleWorkspace({
            organizationId: workspaces[0]!.clerk_org_id,
            getToken,
            setActive: (params) => setActive(params),
          });
          window.location.replace(WORKSPACE_HOME);
          return;
        }
        setState({ kind: "ready", workspaces });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", error: toApiError(error) });
      });

    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, router, setActive]);

  async function chooseWorkspace(workspace: WorkspaceSummary) {
    if (state.kind !== "ready") return;
    const workspaces = state.workspaces;
    setState({ kind: "switching", workspaces, selectedId: workspace.clerk_org_id });
    try {
      await activateAccessibleWorkspace({
        organizationId: workspace.clerk_org_id,
        getToken,
        setActive: (params) => setActive(params),
      });
      window.location.replace(WORKSPACE_HOME);
    } catch (error) {
      setState({ kind: "error", error: toApiError(error) });
    }
  }

  function retry() {
    window.location.reload();
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-auth-night px-5 py-10 text-auth-text">
      <section className="w-full max-w-xl" aria-live="polite">
        <AuthBrand />
        {state.kind === "loading" || state.kind === "switching" ? (
          <div className="mt-10 rounded-2xl border border-auth-line bg-auth-panel p-7 sm:p-9">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-auth-gold" aria-hidden="true" />
              <h1 className="font-display text-3xl">
                {state.kind === "switching" ? "Opening workspace" : "Checking your workspaces"}
              </h1>
            </div>
            <p className="mt-3 text-sm leading-6 text-auth-dark-muted">
              We verify your access with Drezivo before loading business information.
            </p>
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <div className="mt-10 rounded-2xl border border-auth-line bg-auth-panel p-7 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-auth-gold">
              Drezivo workspace
            </p>
            <h1 className="mt-2 font-display text-3xl">Choose a workspace</h1>
            <p className="mt-3 text-sm leading-6 text-auth-dark-muted">
              Select the business you want to open. Your role and access are specific to each
              workspace.
            </p>
            <div className="mt-7 space-y-3">
              {state.workspaces.map((workspace) => (
                <button
                  key={workspace.clerk_org_id}
                  type="button"
                  onClick={() => void chooseWorkspace(workspace)}
                  className="flex min-h-16 w-full items-center gap-4 rounded-xl border border-auth-line bg-transparent px-4 py-3 text-left transition hover:border-auth-gold/60 hover:bg-auth-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-auth-gold/10 text-auth-gold">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-auth-text">
                      {workspace.tenant.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-auth-dark-muted">
                      {workspace.role === "owner" ? "Owner" : "Front Desk"}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-auth-gold">Open</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div
            className="mt-10 rounded-2xl border border-auth-line bg-auth-panel p-7 sm:p-9"
            role="alert"
          >
            <h1 className="font-display text-3xl">We could not load your workspaces</h1>
            <p className="mt-3 text-sm leading-6 text-auth-dark-muted">{state.error.message}</p>
            <Button className="mt-7" onClick={retry}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function toApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not verify your workspace access. Please try again.", {
    status: 500,
  });
}
