"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { BarChart3, CheckCircle2, Gem, Package, Sprout, UsersRound, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  chooseOnboardingPlanRequest,
  type OnboardingActorContext,
  type PlanCode,
} from "@drezivo/contracts";

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { OnboardingStatusPage } from "@/components/onboarding/onboarding-status-page";
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

// Display copy only. The API accepts only `plan_code`; price and quota authority stays in the backend.
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
  const router = useRouter();
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>("professional");
  const [persistedPlan, setPersistedPlan] = useState<PlanCode | null>(null);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<DrezivoApiError | null>(null);

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
      setSaveConfirmed(false);
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
          <h1 className="mt-10 font-display text-4xl text-auth-text">We could not load your plans</h1>
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

  const onboarding = state.context.onboarding;
  if (!onboarding) return <OnboardingStatusPage />;

  const onboardingId = onboarding.id;
  const selectionIsPersisted = persistedPlan === selectedPlan;

  function handlePlanChange(planCode: PlanCode) {
    if (isSubmitting) return;
    setSelectedPlan(planCode);
    setSaveConfirmed(false);
    setSubmitError(null);
    resetIntent();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || selectionIsPersisted) return;

    const parsed = chooseOnboardingPlanRequest.safeParse({ plan_code: selectedPlan });
    if (!parsed.success) {
      setSubmitError(new DrezivoApiError("Choose a valid plan to continue.", { status: 422 }));
      return;
    }

    setSubmitError(null);
    try {
      const result = await submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).selectOnboardingPlan(
          onboardingId,
          parsed.data,
          idempotencyKey
        )
      );
      if (!result) return;

      setPersistedPlan(result.data.selected_plan_code);
      setSaveConfirmed(true);
      resetIntent();

      if (result.data.status === "payment_pending") {
        router.replace("/onboarding");
      }
    } catch (caughtError) {
      setSubmitError(toDrezivoApiError(caughtError));
    }
  }

  return (
    <PlanFrame>
      <section aria-labelledby="plan-heading" className="mx-auto w-full max-w-4xl py-8 sm:py-10">
        <div className="text-center">
          <AuthBrand />
          <p className="mt-2 text-xs font-medium tracking-[0.35em] text-auth-dark-muted">
            FOR PROFESSIONALS
          </p>
        </div>

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

        <form className="mt-8" onSubmit={handleSubmit}>
          <fieldset>
            <legend className="sr-only">Drezivo subscription plan</legend>
            <div className="grid gap-4 xl:grid-cols-3">
              {PLAN_OPTIONS.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  selected={selectedPlan === plan.code}
                  disabled={isSubmitting}
                  onSelect={() => handlePlanChange(plan.code)}
                />
              ))}
            </div>
          </fieldset>

          <p className="mt-6 text-center text-xs leading-5 text-auth-dark-muted sm:text-sm">
            All plans include core privacy, roles, exports, and safe financial lifecycle tools.
          </p>

          {submitError ? (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error"
            >
              <p>{submitError.message}</p>
              {submitError.requestId ? (
                <p className="mt-1 text-xs">Support reference: {submitError.requestId}</p>
              ) : null}
            </div>
          ) : null}

          {saveConfirmed ? (
            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-auth-gold" role="status">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              Plan saved.
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || selectionIsPersisted}
            className={`${primaryButtonClass} mt-6`}
          >
            {isSubmitting ? "Saving plan…" : selectionIsPersisted ? "Plan saved" : "Continue"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-5">
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
          <Link
            href="/onboarding"
            className="text-sm font-medium text-auth-text transition-colors hover:text-auth-gold"
          >
            Back
          </Link>
          <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
        </div>
      </section>
    </PlanFrame>
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
        "relative flex min-h-64 cursor-pointer flex-col rounded-xl border p-5 transition",
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
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={[
          "absolute right-5 top-5 flex h-5 w-5 items-center justify-center rounded-full border",
          selected ? "border-auth-gold" : "border-auth-dark-muted",
        ].join(" ")}
      >
        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-auth-text" /> : null}
      </span>

      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-auth-hover text-auth-gold">
        <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <span className="mt-4 font-display text-2xl text-auth-text">{plan.name}</span>
      <span className="mt-1 font-display text-2xl text-auth-gold">
        {plan.monthlyPrice} <span className="text-base">/ month</span>
      </span>
      <span className="mt-1 text-sm text-auth-text">7-day trial</span>

      <span className="my-4 h-px bg-auth-line" />

      <span className="mt-auto space-y-3 text-sm text-auth-dark-muted">
        <span className="flex items-center gap-3">
          <Package aria-hidden="true" className="h-4 w-4 text-auth-text" />
          {plan.assets}
        </span>
        <span className="flex items-center gap-3">
          <UsersRound aria-hidden="true" className="h-4 w-4 text-auth-text" />
          {plan.seats}
        </span>
      </span>
    </label>
  );
}

function PlanFrame({ children }: { children: React.ReactNode }) {
  return (
    <AuthSplitLayout
      backHref="/onboarding"
      backAriaLabel="Back to onboarding"
      panelAriaLabel="Drezivo plan selection"
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
  "inline-flex min-h-12 w-full items-center justify-center rounded-full bg-auth-button px-6 text-sm font-semibold text-auth-button-ink transition hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:bg-auth-dark-muted disabled:text-auth-panel disabled:opacity-60";
