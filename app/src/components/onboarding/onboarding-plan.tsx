"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth, useClerk } from "@clerk/nextjs";
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Gem,
  Package,
  Sprout,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  chooseOnboardingPlanRequest,
  type OnboardingActorContext,
  type OrganizationOnboarding,
  type PlanCode,
  type TenantBootstrapResponse,
} from "@drezivo/contracts";

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { OnboardingStatusPage } from "@/components/onboarding/onboarding-status-page";
import { RestartOnboardingDialog } from "@/components/onboarding/restart-onboarding-dialog";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type PlanDefinition = {
  code: PlanCode;
  name: string;
  monthlyPrice: string;
  assets: string;
  seats: string;
  icon: LucideIcon;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "ready"; context: OnboardingActorContext };

type ScreenMode = "select" | "review";
type LaunchPhase = "idle" | "bootstrapping" | "resolving" | "context-error";

// Display metadata only. The API accepts only `plan_code`; price and quota authority stays server-side.
const PLAN_OPTIONS: readonly PlanDefinition[] = [
  {
    code: "starter",
    name: "Starter",
    monthlyPrice: "₱300",
    assets: "75 active assets",
    seats: "1 Front Desk seat",
    icon: Sprout,
  },
  {
    code: "professional",
    name: "Professional",
    monthlyPrice: "₱499",
    assets: "250 active assets",
    seats: "3 Front Desk seats",
    icon: Gem,
  },
  {
    code: "business",
    name: "Business",
    monthlyPrice: "₱1,299",
    assets: "1,000 active assets",
    seats: "10 Front Desk seats",
    icon: BarChart3,
  },
];

export function OnboardingPlan() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const planSubmit = useSubmitGuard();
  const launchSubmit = useSubmitGuard();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>("professional");
  const [persistedPlan, setPersistedPlan] = useState<PlanCode | null>(null);
  const [mode, setMode] = useState<ScreenMode>("select");
  const [planError, setPlanError] = useState<DrezivoApiError | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  const [launchError, setLaunchError] = useState<DrezivoApiError | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<TenantBootstrapResponse | null>(null);

  const loadCurrent = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setState({ kind: "loading" });
    try {
      const result = await createDrezivoApiClient(getToken).getCurrentOnboarding();
      const onboarding = result.data.onboarding;

      if (
        !onboarding ||
        result.data.has_current_owned_tenant ||
        onboarding.status !== "incomplete"
      ) {
        router.replace("/onboarding");
        return;
      }

      const initialPlan = onboarding.selected_plan_code ?? "professional";
      setSelectedPlan(initialPlan);
      setPersistedPlan(onboarding.selected_plan_code);
      setMode(onboarding.selected_plan_code ? "review" : "select");
      setState({ kind: "ready", context: result.data });
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

  if (state.kind === "error") {
    return (
      <PlanFrame>
        <section className="mx-auto w-full max-w-xl py-10 text-center">
          <AuthBrand />
          <h1 className="mt-10 font-display text-4xl text-auth-text">We could not load your setup</h1>
          <p className="mt-4 text-sm leading-6 text-auth-dark-muted">{state.error.message}</p>
          {state.error.requestId ? (
            <p className="mt-2 text-xs text-auth-dark-muted">Support reference: {state.error.requestId}</p>
          ) : null}
          <button type="button" onClick={() => void loadCurrent()} className={`${primaryButtonClass} mt-8`}>
            Try again
          </button>
        </section>
      </PlanFrame>
    );
  }

  const readyContext = state.context;
  const onboarding = readyContext.onboarding;
  if (!onboarding) return <OnboardingStatusPage />;
  const activeOnboarding = onboarding;

  const plan = PLAN_OPTIONS.find((option) => option.code === persistedPlan) ?? null;

  if (launchPhase === "resolving") {
    return <ProvisioningState title="Creating your workspace…" description="Your workspace is ready. We’re loading your access and dashboard now." />;
  }

  if (launchPhase === "context-error" && bootstrapResult) {
    return (
      <PlanFrame>
        <section className="mx-auto w-full max-w-xl py-10 text-center">
          <AuthBrand />
          <CheckCircle2 aria-hidden="true" className="mx-auto mt-10 h-12 w-12 text-auth-gold" />
          <h1 className="mt-6 font-display text-4xl text-auth-text">Your workspace was created</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-auth-dark-muted">
            We couldn&apos;t finish loading your workspace access. Your trial has already started, so retrying here will only reload your workspace and will not launch it again.
          </p>
          {launchError?.requestId ? (
            <p className="mt-3 text-xs text-auth-dark-muted">Support reference: {launchError.requestId}</p>
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

  if (mode === "review" && plan) {
    return (
      <LaunchReview
        getToken={getToken}
        onboarding={activeOnboarding}
        plan={plan}
        launchError={launchError}
        launchOpen={launchOpen}
        launchPhase={launchPhase}
        onChangePlan={() => {
          setPlanError(null);
          setMode("select");
        }}
        onLaunchOpenChange={(open) => {
          if (launchPhase === "bootstrapping") return;
          if (open) {
            launchSubmit.resetIntent();
            setLaunchError(null);
          }
          setLaunchOpen(open);
        }}
        onConfirmLaunch={() => void handleLaunch()}
        onRestarted={() => router.replace("/onboarding")}
      />
    );
  }

  const selectionIsPersisted = persistedPlan === selectedPlan;

  function handlePlanChange(planCode: PlanCode) {
    if (planSubmit.isSubmitting) return;
    setSelectedPlan(planCode);
    setPlanError(null);
    planSubmit.resetIntent();
  }

  async function handlePlanSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (planSubmit.isSubmitting) return;

    if (selectionIsPersisted) {
      setMode("review");
      return;
    }

    const parsed = chooseOnboardingPlanRequest.safeParse({ plan_code: selectedPlan });
    if (!parsed.success) {
      setPlanError(new DrezivoApiError("Choose a valid plan to continue.", { status: 422 }));
      return;
    }

    setPlanError(null);
    try {
      const result = await planSubmit.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).selectOnboardingPlan(activeOnboarding.id, parsed.data, idempotencyKey)
      );
      if (!result) return;

      planSubmit.resetIntent();
      if (result.data.status === "payment_pending") {
        router.replace("/onboarding");
        return;
      }

      setPersistedPlan(result.data.selected_plan_code);
      setState({
        kind: "ready",
        context: { ...readyContext, onboarding: result.data },
      });
      setMode("review");
    } catch (caughtError) {
      setPlanError(toDrezivoApiError(caughtError));
    }
  }

  async function handleLaunch() {
    if (launchPhase === "bootstrapping" || !persistedPlan) return;

    setLaunchError(null);
    setLaunchPhase("bootstrapping");
    try {
      const result = await launchSubmit.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).bootstrapOnboarding(activeOnboarding.id, {}, idempotencyKey)
      );
      if (!result) return;

      setBootstrapResult(result.data);
      setLaunchOpen(false);
      launchSubmit.resetIntent();
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
      const api = createDrezivoApiClient(getToken);
      const workspaces = await api.getWorkspaces();
      const workspace = workspaces.data.items.find(
        (item) => item.tenant.id === bootstrap.tenant.id || item.clerk_org_id === activeOnboarding.clerk_org_id
      );
      if (!workspace) {
        throw new DrezivoApiError("Your workspace was created, but it is not available to load yet.", {
          status: 409,
        });
      }

      await setActive({ organization: workspace.clerk_org_id });
      const actor = await api.getActorContext();
      if (actor.data.tenant.id !== bootstrap.tenant.id) {
        throw new DrezivoApiError("Your workspace context did not match the workspace that was created.", {
          status: 409,
        });
      }

      router.replace("/");
    } catch (caughtError) {
      setLaunchError(toDrezivoApiError(caughtError));
      setLaunchPhase("context-error");
    }
  }

  return (
    <PlanFrame>
      <section aria-labelledby="plan-heading" className="mx-auto w-full max-w-4xl py-8 sm:py-10">
        <BrandHeader />
        <div className="mx-auto mt-9 max-w-2xl">
          <OnboardingProgress current="plan" />
        </div>

        <div className="mt-10 text-center">
          <h1 id="plan-heading" className="font-display text-4xl leading-tight text-auth-text sm:text-5xl">
            Choose your plan
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-auth-dark-muted sm:text-base">
            Pick a plan for your rental business. All plans start with a 7-day trial.
          </p>
        </div>

        <form className="mt-7" onSubmit={handlePlanSubmit}>
          <fieldset>
            <legend className="sr-only">Drezivo subscription plan</legend>
            <div className="mx-auto max-w-[52rem]">
              <div className="grid gap-3 xl:grid-cols-3">
                {PLAN_OPTIONS.map((option) => (
                  <PlanCard
                    key={option.code}
                    plan={option}
                    selected={selectedPlan === option.code}
                    disabled={planSubmit.isSubmitting}
                    onSelect={() => handlePlanChange(option.code)}
                  />
                ))}
              </div>
            </div>
          </fieldset>

          <p className="mt-4 text-center text-xs leading-5 text-auth-dark-muted sm:text-sm">
            All plans include core privacy, roles, exports, and safe financial lifecycle tools.
          </p>

          {planError ? <InlineError error={planError} /> : null}

          <button type="submit" disabled={planSubmit.isSubmitting} className={`${primaryButtonClass} mt-5`}>
            {planSubmit.isSubmitting ? "Saving plan…" : "Continue"}
          </button>
        </form>

        <div className="mt-5 flex items-center gap-5">
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
          <button
            type="button"
            onClick={() => router.replace("/onboarding")}
            className="text-sm font-medium text-auth-text transition-colors hover:text-auth-gold"
          >
            Back
          </button>
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
        </div>
      </section>
    </PlanFrame>
  );
}

function LaunchReview({
  getToken,
  launchError,
  launchOpen,
  launchPhase,
  onboarding,
  onChangePlan,
  onConfirmLaunch,
  onLaunchOpenChange,
  onRestarted,
  plan,
}: {
  getToken: () => Promise<string | null>;
  launchError: DrezivoApiError | null;
  launchOpen: boolean;
  launchPhase: LaunchPhase;
  onboarding: OrganizationOnboarding;
  onChangePlan: () => void;
  onConfirmLaunch: () => void;
  onLaunchOpenChange: (open: boolean) => void;
  onRestarted: () => void;
  plan: PlanDefinition;
}) {
  const isLaunching = launchPhase === "bootstrapping";

  return (
    <PlanFrame>
      <section aria-labelledby="launch-heading" className="mx-auto w-full max-w-[52rem] py-4 sm:py-5">
        <BrandHeader />
        <div className="mx-auto mt-6 max-w-xl">
          <OnboardingProgress current="launch" />
        </div>

        <div className="mt-6 text-center">
          <h1 id="launch-heading" className="font-display text-3xl leading-tight text-auth-text sm:text-4xl">
            Review and launch
          </h1>
          <p className="mt-2 text-sm text-auth-dark-muted">
            Check your setup before creating your workspace.
          </p>
        </div>

        <div className="mx-auto mt-5 max-w-[48rem] rounded-xl border border-auth-line px-4 sm:px-6">
          <ReviewRow label="Organization">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl text-auth-text">{onboarding.organization_name}</p>
              <p className="mt-1 truncate text-sm text-auth-dark-muted">
                {onboarding.requested_slug
                  ? `drezivo.com/s/${onboarding.requested_slug}`
                  : "A storefront slug will be assigned at launch."}
              </p>
            </div>
            <RestartOnboardingDialog
              getToken={getToken}
              onboarding={onboarding}
              onRestarted={onRestarted}
              triggerClassName={changeButtonClass}
              triggerLabel="Change"
            />
          </ReviewRow>

          <ReviewRow label="Plan">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl text-auth-text">{plan.name}</p>
              <p className="mt-1 text-sm text-auth-dark-muted">{plan.monthlyPrice} / month · 7-day trial</p>
            </div>
            <button type="button" onClick={onChangePlan} className={changeButtonClass}>
              Change
            </button>
          </ReviewRow>

          <ReviewRow label="Limits">
            <p className="text-sm text-auth-text sm:text-base">
              {plan.assets} <span className="mx-2 text-auth-dark-muted">·</span> {plan.seats}
            </p>
          </ReviewRow>

          <ReviewRow label="When you launch" last>
            <div className="space-y-2.5 text-sm text-auth-dark-muted">
              <LaunchEffect>Create your workspace</LaunchEffect>
              <LaunchEffect>Start your 7-day trial</LaunchEffect>
              <LaunchEffect>Continue to your dashboard</LaunchEffect>
            </div>
          </ReviewRow>
        </div>

        {launchError && !launchOpen ? <InlineError error={launchError} /> : null}

        <Dialog.Root open={launchOpen} onOpenChange={onLaunchOpenChange}>
          <Dialog.Trigger asChild>
            <button type="button" className={`${launchButtonClass} mx-auto mt-4 max-w-[48rem]`}>
              Launch Workspace <ArrowRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-auth-page/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-auth-line bg-auth-panel p-6 shadow-2xl outline-none sm:p-7">
              <Dialog.Title className="font-display text-3xl text-auth-text">Start your 7-day trial?</Dialog.Title>
              <Dialog.Description className="mt-3 text-sm leading-6 text-auth-dark-muted">
                Launching your workspace starts your 7-day trial immediately. No credit card is required during the trial period, and your lifetime trial can only be used once.
              </Dialog.Description>

              <div className="mt-5 rounded-xl border border-auth-line bg-auth-page/30 p-4 text-sm text-auth-dark-muted">
                <p className="font-semibold text-auth-text">{plan.name}</p>
                <p className="mt-1">{plan.monthlyPrice} / month after the trial period.</p>
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
                  onClick={onConfirmLaunch}
                  className={dialogLaunchButtonClass}
                >
                  {isLaunching ? "Starting trial…" : "Start 7-day trial"}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <p className="mt-3 text-center text-xs text-auth-dark-muted">
          Drezivo will load your workspace after launch.
        </p>

        <div className="mx-auto mt-4 flex max-w-[48rem] items-center gap-5">
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
          <button type="button" onClick={onChangePlan} className="text-sm font-medium text-auth-text hover:text-auth-gold">
            Back
          </button>
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
        </div>
      </section>
    </PlanFrame>
  );
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
    <div className={`grid gap-3 py-4 sm:grid-cols-[7.5rem_1fr] ${last ? "" : "border-b border-auth-line"}`}>
      <p className="text-sm font-medium text-auth-dark-muted sm:text-base">{label}</p>
      <div className="flex min-w-0 items-start justify-between gap-4">{children}</div>
    </div>
  );
}

function LaunchEffect({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-auth-gold text-auth-panel">
        <Check aria-hidden="true" className="h-4 w-4" />
      </span>
      {children}
    </p>
  );
}

function ProvisioningState({ title, description }: { title: string; description: string }) {
  return (
    <PlanFrame>
      <section className="mx-auto w-full max-w-xl py-10 text-center" aria-live="polite">
        <AuthBrand />
        <div className="mx-auto mt-10 h-10 w-10 animate-spin rounded-full border-2 border-auth-line border-t-auth-gold" />
        <h1 className="mt-8 font-display text-4xl text-auth-text">{title}</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-auth-dark-muted">{description}</p>
      </section>
    </PlanFrame>
  );
}

function BrandHeader() {
  return (
    <div className="text-center">
      <AuthBrand />
      <p className="mt-2 text-xs font-medium tracking-[0.35em] text-auth-dark-muted">FOR PROFESSIONALS</p>
    </div>
  );
}

function PlanCard({
  disabled,
  onSelect,
  plan,
  selected,
}: {
  disabled: boolean;
  onSelect: () => void;
  plan: PlanDefinition;
  selected: boolean;
}) {
  const Icon = plan.icon;

  return (
    <label
      className={[
        "relative flex min-h-56 cursor-pointer flex-col rounded-xl border p-4 transition",
        selected
          ? "border-auth-gold bg-auth-gold/10 shadow-[0_0_0_1px_var(--color-auth-gold)]"
          : "border-auth-line bg-auth-panel/40 hover:border-auth-gold/60",
        disabled ? "cursor-not-allowed opacity-70" : "",
      ].join(" ")}
    >
      <input
        type="radio"
        name="plan"
        value={plan.code}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        aria-label={`${plan.name} ${plan.monthlyPrice} per month`}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={[
          "absolute right-4 top-4 flex h-4.5 w-4.5 items-center justify-center rounded-full border",
          selected ? "border-auth-gold" : "border-auth-dark-muted",
        ].join(" ")}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-auth-text" /> : null}
      </span>

      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-auth-hover text-auth-gold">
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
      </span>
      <span className="mt-3 font-display text-xl text-auth-text">{plan.name}</span>
      <span className="mt-1 font-display text-xl text-auth-gold">
        {plan.monthlyPrice} <span className="text-sm">/ month</span>
      </span>
      <span className="mt-1 text-xs text-auth-text">7-day trial</span>

      <span className="my-3 h-px bg-auth-line" />

      <span className="mt-auto space-y-2 text-xs text-auth-dark-muted sm:text-sm">
        <span className="flex items-center gap-2.5">
          <Package aria-hidden="true" className="h-4 w-4 text-auth-text" />
          {plan.assets}
        </span>
        <span className="flex items-center gap-2.5">
          <UsersRound aria-hidden="true" className="h-4 w-4 text-auth-text" />
          {plan.seats}
        </span>
      </span>
    </label>
  );
}

function InlineError({ error }: { error: DrezivoApiError }) {
  return (
    <div
      role="alert"
      className="mt-5 rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error"
    >
      <p>{error.message}</p>
      {error.requestId ? <p className="mt-1 text-xs">Support reference: {error.requestId}</p> : null}
    </div>
  );
}

function PlanFrame({ children }: { children: React.ReactNode }) {
  return (
    <AuthSplitLayout
      backHref="/onboarding"
      backAriaLabel="Back to onboarding"
      panelAriaLabel="Drezivo onboarding"
      lockViewport
    >
      <div className="flex flex-1 items-center">{children}</div>
    </AuthSplitLayout>
  );
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
