"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth, useClerk } from "@clerk/nextjs";
import { ArrowRight, CheckCircle2, Package, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  OnboardingActorContext,
  OrganizationOnboarding,
  PlanCode,
  PublicPlanCatalogItem,
  PublicPlanCatalogResponse,
  TenantBootstrapResponse,
} from "@drezivo/contracts";

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { ExitOnboardingDialog } from "@/components/onboarding/exit-onboarding-dialog";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { OnboardingStatusPage } from "@/components/onboarding/onboarding-status-page";
import { RestartOnboardingDialog } from "@/components/onboarding/restart-onboarding-dialog";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "catalog-error"; context: OnboardingActorContext; error: DrezivoApiError }
  | { kind: "ready"; context: OnboardingActorContext; catalog: PublicPlanCatalogResponse };

type LaunchPhase = "idle" | "bootstrapping" | "resolving" | "context-error";

/** Owners select a catalog plan before starting the trial; the API remains authoritative. */
export function OnboardingPlan() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const planSubmit = useSubmitGuard();
  const launchSubmit = useSubmitGuard();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [step, setStep] = useState<"plan" | "launch">("plan");
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode | null>(null);
  const [planError, setPlanError] = useState<DrezivoApiError | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  const [launchError, setLaunchError] = useState<DrezivoApiError | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<TenantBootstrapResponse | null>(null);

  const loadCurrent = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setState({ kind: "loading" });
    try {
      const api = createDrezivoApiClient(getToken);
      const [contextResult, catalogResult] = await Promise.allSettled([
        api.getCurrentOnboarding(),
        api.getPublicPlanCatalog(),
      ]);
      if (contextResult.status === "rejected") throw contextResult.reason;
      const context = contextResult.value.data;
      const onboarding = context.onboarding;
      if (!onboarding || context.has_current_owned_tenant || onboarding.status !== "incomplete") {
        router.replace("/onboarding");
        return;
      }
      setSelectedPlanCode(onboarding.selected_plan_code);
      setStep(onboarding.selected_plan_code ? "launch" : "plan");
      setLaunchOpen(Boolean(onboarding.selected_plan_code));
      if (catalogResult.status === "rejected") {
        setState({
          kind: "catalog-error",
          context,
          error: toDrezivoApiError(catalogResult.reason),
        });
        return;
      }
      setState({ kind: "ready", context, catalog: catalogResult.value.data });
    } catch (caughtError) {
      setState({ kind: "error", error: toDrezivoApiError(caughtError) });
    }
  }, [getToken, isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    void loadCurrent();
  }, [isLoaded, isSignedIn, loadCurrent, router]);

  if (!isLoaded || !isSignedIn || state.kind === "loading") {
    return <OnboardingStatusPage />;
  }

  if (state.kind === "error" || state.kind === "catalog-error") {
    return (
      <PlanFrame>
        <section className="mx-auto w-full max-w-xl py-10 text-center">
          <AuthBrand />
          <h1 className="mt-10 font-display text-4xl text-auth-text">
            {state.kind === "catalog-error"
              ? "We could not load the plans"
              : "We could not load your setup"}
          </h1>
          <p className="mt-4 text-sm leading-6 text-auth-dark-muted">{state.error.message}</p>
          {state.error.requestId ? (
            <p className="mt-2 text-xs text-auth-dark-muted">
              Support reference: {state.error.requestId}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void loadCurrent()}
            className={`${primaryButtonClass} mt-8`}
          >
            Try again
          </button>
        </section>
      </PlanFrame>
    );
  }

  const readyState = state;
  const onboarding = readyState.context.onboarding;
  if (!onboarding) return <OnboardingStatusPage />;
  const activeOnboarding = onboarding;
  const selectedPlan = readyState.catalog.plans.find(
    (plan) => plan.code === (selectedPlanCode ?? activeOnboarding.selected_plan_code)
  );

  async function handleSavePlan() {
    if (!selectedPlanCode || planSubmit.isSubmitting) return;
    setPlanError(null);
    try {
      const result = await planSubmit.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).selectOnboardingPlan(
          activeOnboarding.id,
          { plan_code: selectedPlanCode },
          idempotencyKey
        )
      );
      if (!result) return;
      setState({
        kind: "ready",
        context: { ...readyState.context, onboarding: result.data },
        catalog: readyState.catalog,
      });
      setSelectedPlanCode(result.data.selected_plan_code);
      setStep("launch");
      setLaunchError(null);
      setLaunchOpen(true);
    } catch (caughtError) {
      setPlanError(toDrezivoApiError(caughtError));
    }
  }

  if (step === "plan") {
    return (
      <PlanFrame getToken={getToken} onboarding={activeOnboarding}>
        <PlanSelection
          catalog={readyState.catalog}
          error={planError}
          isSaving={planSubmit.isSubmitting}
          onContinue={() => void handleSavePlan()}
          onSelect={(code) => {
            setSelectedPlanCode(code);
            setPlanError(null);
          }}
          selectedCode={selectedPlanCode}
        />
      </PlanFrame>
    );
  }

  if (!selectedPlan) {
    return (
      <PlanFrame getToken={getToken} onboarding={activeOnboarding}>
        <section className="mx-auto w-full max-w-xl py-10 text-center">
          <AuthBrand />
          <h1 className="mt-10 font-display text-4xl text-auth-text">
            Your selected plan is unavailable
          </h1>
          <p className="mt-4 text-sm leading-6 text-auth-dark-muted">
            Reload the plan list and choose an available plan before starting your trial.
          </p>
          <button
            type="button"
            onClick={() => void loadCurrent()}
            className={`${primaryButtonClass} mt-8`}
          >
            Reload plans
          </button>
        </section>
      </PlanFrame>
    );
  }

  if (launchPhase === "resolving") {
    return (
      <ProvisioningState
        title="Creating your workspace…"
        description="Your trial has started. We’re opening your dashboard now."
      />
    );
  }

  if (launchPhase === "context-error" && bootstrapResult) {
    return (
      <PlanFrame>
        <section className="mx-auto w-full max-w-xl py-10 text-center">
          <AuthBrand />
          <CheckCircle2 aria-hidden="true" className="mx-auto mt-10 h-12 w-12 text-auth-gold" />
          <h1 className="mt-6 font-display text-4xl text-auth-text">Your workspace was created</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-auth-dark-muted">
            We couldn&apos;t finish loading your workspace. Your trial has already started, so
            trying again only reloads your workspace.
          </p>
          {launchError?.requestId ? (
            <p className="mt-3 text-xs text-auth-dark-muted">
              Support reference: {launchError.requestId}
            </p>
          ) : null}
          <button
            type="button"
            className={`${primaryButtonClass} mt-8`}
            onClick={() => void resolveWorkspace(bootstrapResult)}
          >
            Try loading workspace again
          </button>
        </section>
      </PlanFrame>
    );
  }

  async function handleStartTrial() {
    if (launchPhase === "bootstrapping") return;
    setLaunchError(null);
    setLaunchPhase("bootstrapping");
    try {
      const result = await launchSubmit.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).startOnboardingTrial(activeOnboarding.id, idempotencyKey)
      );
      if (!result) return;
      setBootstrapResult(result.data);
      setLaunchOpen(false);
      await resolveWorkspace(result.data);
    } catch (caughtError) {
      setLaunchPhase("idle");
      setLaunchError(toDrezivoApiError(caughtError));
    }
  }

  async function resolveWorkspace(bootstrap: TenantBootstrapResponse) {
    setLaunchPhase("resolving");
    setLaunchError(null);
    try {
      await withTimeout(async () => {
        const api = createDrezivoApiClient(getToken);
        const workspaces = await api.getWorkspaces();
        const workspace = workspaces.data.items.find(
          (item) =>
            item.tenant.id === bootstrap.tenant.id ||
            item.clerk_org_id === activeOnboarding.clerk_org_id
        );
        if (!workspace) {
          throw new DrezivoApiError(
            "Your workspace was created, but it is not available to load yet.",
            { status: 409 }
          );
        }
        await setActive({ organization: workspace.clerk_org_id });
        const actor = await api.getActorContext();
        if (actor.data.tenant.id !== bootstrap.tenant.id) {
          throw new DrezivoApiError(
            "Your workspace context did not match the workspace that was created.",
            { status: 409 }
          );
        }
      });
      // Full navigation: Clerk refreshes the router after switching organizations (see post-auth-resolver).
      window.location.replace(WORKSPACE_HOME);
    } catch (caughtError) {
      setLaunchError(toDrezivoApiError(caughtError));
      setLaunchPhase("context-error");
    }
  }

  const isLaunching = launchPhase === "bootstrapping";

  return (
    <PlanFrame getToken={getToken} onboarding={activeOnboarding}>
      <section aria-labelledby="trial-heading" className="mx-auto w-full max-w-xl py-6 sm:py-8">
        <BrandHeader />
        <div className="mx-auto mt-7 max-w-md">
          <OnboardingProgress current="launch" />
        </div>

        <div className="mt-8 text-center">
          <h1
            id="trial-heading"
            className="font-display text-3xl leading-tight text-auth-text sm:text-4xl"
          >
            Start your free trial
          </h1>
          <p className="mt-2 text-sm text-auth-dark-muted">
            Your selected plan includes a {selectedPlan.trial_days}-day trial. No card needed.
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-auth-line px-4 sm:px-6">
          <ReviewRow label="Business">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl text-auth-text">
                {activeOnboarding.organization_name}
              </p>
              <p className="mt-1 text-sm text-auth-dark-muted">
                Your storefront address is created automatically.
              </p>
            </div>
            <RestartOnboardingDialog
              getToken={getToken}
              onboarding={activeOnboarding}
              onRestarted={() => router.replace("/onboarding")}
              triggerClassName={changeButtonClass}
              triggerLabel="Change"
            />
          </ReviewRow>
          <ReviewRow label="Plan" last>
            <div className="min-w-0 flex-1">
              <PlanSummary plan={selectedPlan} />
              <button
                type="button"
                className={`${changeButtonClass} mt-3`}
                onClick={() => {
                  setLaunchOpen(false);
                  setStep("plan");
                }}
              >
                Change plan
              </button>
            </div>
          </ReviewRow>
        </div>

        {launchError && !launchOpen ? <InlineError error={launchError} /> : null}

        <Dialog.Root
          open={launchOpen}
          onOpenChange={(open: boolean) => {
            if (isLaunching) return;
            if (open) {
              launchSubmit.resetIntent();
              setLaunchError(null);
            }
            setLaunchOpen(open);
          }}
        >
          <Dialog.Trigger asChild>
            <button type="button" className={`${launchButtonClass} mt-5`}>
              Start {selectedPlan.trial_days}-day trial{" "}
              <ArrowRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-auth-page/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-auth-line bg-auth-panel p-6 shadow-2xl outline-none sm:p-7">
              <Dialog.Title className="font-display text-3xl text-auth-text">
                Start your {selectedPlan.trial_days}-day trial?
              </Dialog.Title>
              <Dialog.Description className="mt-3 text-sm leading-6 text-auth-dark-muted">
                Your trial starts now. After the trial, {selectedPlan.name} is{" "}
                {formatPlanPrice(selectedPlan.monthly_price_minor)} a month.
              </Dialog.Description>
              <div className="mt-5 rounded-xl border border-auth-line bg-auth-page/30 p-4">
                <PlanSummary plan={selectedPlan} />
              </div>
              {launchError ? <InlineError error={launchError} /> : null}
              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button type="button" disabled={isLaunching} className={dialogCancelButtonClass}>
                    Not yet
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={isLaunching}
                  onClick={() => void handleStartTrial()}
                  className={dialogLaunchButtonClass}
                >
                  {isLaunching ? "Starting trial…" : `Start ${selectedPlan.trial_days}-day trial`}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    </PlanFrame>
  );
}

function PlanSummary({ plan }: { plan: PublicPlanCatalogItem }) {
  const seats =
    plan.limits.frontdesk_seats > 0
      ? `Up to ${plan.limits.frontdesk_seats} Front Desk staff`
      : null;
  return (
    <div className="min-w-0 flex-1 text-sm text-auth-dark-muted">
      <p className="font-display text-xl text-auth-text">
        {plan.name}{" "}
        <span className="text-base text-auth-gold">
          {formatPlanPrice(plan.monthly_price_minor)} / month after the trial
        </span>
      </p>
      <p className="mt-2 flex items-center gap-2">
        <Package aria-hidden="true" className="h-4 w-4 text-auth-text" /> Up to{" "}
        {plan.limits.active_garments} active garments
      </p>
      {seats ? (
        <p className="mt-1 flex items-center gap-2">
          <UsersRound aria-hidden="true" className="h-4 w-4 text-auth-text" /> {seats}
        </p>
      ) : null}
    </div>
  );
}

function PlanSelection({
  catalog,
  error,
  isSaving,
  onContinue,
  onSelect,
  selectedCode,
}: {
  catalog: PublicPlanCatalogResponse;
  error: DrezivoApiError | null;
  isSaving: boolean;
  onContinue: () => void;
  onSelect: (code: PlanCode) => void;
  selectedCode: PlanCode | null;
}) {
  return (
    <section aria-labelledby="plan-heading" className="mx-auto w-full max-w-3xl py-6 sm:py-8">
      <BrandHeader />
      <div className="mx-auto mt-7 max-w-md">
        <OnboardingProgress current="plan" />
      </div>
      <div className="mt-8 text-center">
        <h1
          id="plan-heading"
          className="font-display text-3xl leading-tight text-auth-text sm:text-4xl"
        >
          Choose your plan
        </h1>
        <p className="mt-2 text-sm text-auth-dark-muted">
          Both plans include a {catalog.plans[0]?.trial_days ?? 14}-day trial. Review your choice
          before starting.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Subscription plan"
        className="mt-7 grid gap-4 md:grid-cols-2"
      >
        {catalog.plans.map((plan) => {
          const chosen = plan.code === selectedCode;
          const features = [`Up to ${plan.limits.active_garments} active garments`];
          if (plan.limits.frontdesk_seats > 0)
            features.push(`Up to ${plan.limits.frontdesk_seats} Front Desk staff`);
          features.push(
            "Online storefront with bookings and fittings",
            "Reservations, calendar and availability",
            "Customers, payments, returns and exports"
          );
          return (
            <button
              key={plan.code}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onSelect(plan.code)}
              className={`rounded-2xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus ${chosen ? "border-auth-gold bg-auth-gold/10 ring-1 ring-auth-gold" : "border-auth-line bg-auth-panel hover:border-auth-gold/60"}`}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block font-display text-2xl text-auth-text">{plan.name}</span>
                  <span className="mt-1 block text-sm text-auth-dark-muted">
                    {formatPlanPrice(plan.monthly_price_minor)} / month after trial
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${chosen ? "border-auth-gold bg-auth-gold text-auth-panel" : "border-auth-line"}`}
                >
                  {chosen ? <CheckCircle2 className="h-4 w-4" /> : null}
                </span>
              </span>
              <span className="mt-5 block border-t border-auth-line pt-2">
                {features.map((feature) => (
                  <span key={feature} className="flex gap-2 py-2 text-sm text-auth-dark-muted">
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-auth-gold"
                    />
                    {feature}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {error ? <InlineError error={error} /> : null}
      <div className="mx-auto mt-6 max-w-md">
        <button
          type="button"
          disabled={!selectedCode || isSaving}
          onClick={onContinue}
          className={primaryButtonClass}
        >
          {isSaving ? "Saving plan…" : "Continue"}{" "}
          <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function formatPlanPrice(minor: number): string {
  return `₱${(minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function ReviewRow({
  children,
  label,
  last = false,
}: {
  children: React.ReactNode;
  label: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid gap-3 py-4 sm:grid-cols-[7.5rem_1fr] ${last ? "" : "border-b border-auth-line"}`}
    >
      <p className="text-sm font-medium text-auth-dark-muted sm:text-base">{label}</p>
      <div className="flex min-w-0 items-start justify-between gap-4">{children}</div>
    </div>
  );
}

function ProvisioningState({ title, description }: { title: string; description: string }) {
  return (
    <PlanFrame>
      <section className="mx-auto w-full max-w-xl py-10 text-center" aria-live="polite">
        <AuthBrand />
        <div className="mx-auto mt-10 h-10 w-10 animate-spin rounded-full border-2 border-auth-line border-t-auth-gold" />
        <h1 className="mt-8 font-display text-4xl text-auth-text">{title}</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-auth-dark-muted">
          {description}
        </p>
      </section>
    </PlanFrame>
  );
}

function BrandHeader() {
  return (
    <div className="text-center">
      <AuthBrand />
      <p className="mt-2 text-xs font-medium tracking-[0.35em] text-auth-dark-muted">
        FOR PROFESSIONALS
      </p>
    </div>
  );
}

function InlineError({ error }: { error: DrezivoApiError }) {
  return (
    <div
      role="alert"
      className="mt-5 rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error"
    >
      <p>{error.message}</p>
      {error.requestId ? (
        <p className="mt-1 text-xs">Support reference: {error.requestId}</p>
      ) : null}
    </div>
  );
}

function PlanFrame({
  children,
  getToken,
  onboarding,
}: {
  children: React.ReactNode;
  getToken?: () => Promise<string | null>;
  onboarding?: OrganizationOnboarding | null;
}) {
  return (
    <AuthSplitLayout
      backHref="/onboarding"
      backAriaLabel="Back to onboarding"
      panelAriaLabel="Drezivo onboarding"
      lockViewport
      backControl={
        getToken ? (
          <ExitOnboardingDialog getToken={getToken} onboarding={onboarding ?? null} />
        ) : undefined
      }
    >
      <div className="flex flex-1 items-center">{children}</div>
    </AuthSplitLayout>
  );
}

const WORKSPACE_LOAD_TIMEOUT_MS = 20_000;

/**
 * Loading the new workspace waits on Clerk switching the active organization, which can stall.
 * Past the limit the screen offers "Try loading workspace again" instead of spinning forever;
 * retrying is safe because the workspace already exists and bootstrap is not repeated.
 */
async function withTimeout(work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new DrezivoApiError("Loading your workspace is taking too long. Try again.", {
            status: 504,
          })
        ),
      WORKSPACE_LOAD_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not complete that request. Please try again.", {
    status: 500,
  });
}

const primaryButtonClass =
  "inline-flex min-h-10 w-full items-center justify-center rounded-full bg-auth-button px-6 text-sm font-semibold text-auth-button-ink transition hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:opacity-60";
const launchButtonClass =
  "flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-auth-gold px-5 text-sm font-semibold text-auth-panel transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-60";
const changeButtonClass =
  "shrink-0 text-sm font-semibold text-auth-gold underline underline-offset-4 transition hover:text-auth-text";
const dialogCancelButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-auth-line px-5 text-sm font-semibold text-auth-text transition hover:border-auth-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-60";
const dialogLaunchButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-auth-gold px-5 text-sm font-semibold text-auth-panel transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus disabled:cursor-not-allowed disabled:opacity-60";
