import { RefreshCw } from "lucide-react";
import Link from "next/link";

import { AuthBrand } from "@/components/auth/auth-brand";

type OnboardingVisualState = "active" | "pending";

type OnboardingStep = {
  label: string;
  state: OnboardingVisualState;
};

type OnboardingCheck = {
  label: string;
  state: OnboardingVisualState;
};

const onboardingSteps: OnboardingStep[] = [
  { label: "Organization", state: "active" },
  { label: "Plan", state: "pending" },
  { label: "Launch", state: "pending" },
];

const onboardingChecks: OnboardingCheck[] = [
  { label: "Checking organization setup", state: "active" },
  { label: "Checking plan selection", state: "pending" },
  { label: "Preparing workspace access", state: "pending" },
];

export function OnboardingStatusPanel() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-12 sm:py-16">
      <div className="text-center">
        <div className="mb-10">
          <AuthBrand />
        </div>

        <nav aria-label="Onboarding progress" className="mx-auto w-full max-w-md">
          <ol className="flex items-start">
            {onboardingSteps.map((step, index) => (
              <li key={step.label} className="flex min-w-0 flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  {index > 0 ? (
                    <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
                  ) : null}
                  <span
                    aria-current={step.state === "active" ? "step" : undefined}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                      step.state === "active" ? "border-auth-gold" : "border-auth-line"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${step.state === "active" ? "bg-auth-gold" : "bg-auth-line"}`}
                    />
                  </span>
                  {index < onboardingSteps.length - 1 ? (
                    <span aria-hidden="true" className="h-px flex-1 bg-auth-line" />
                  ) : null}
                </div>
                <span
                  className={`mt-3 text-xs font-medium sm:text-sm ${
                    step.state === "active" ? "text-auth-text" : "text-auth-dark-muted"
                  }`}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <h1 className="mt-12 font-display text-4xl leading-tight text-auth-text sm:text-5xl">
          Setting up your workspace
        </h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-auth-dark-muted sm:text-base">
          <span className="block">We&apos;re checking your onboarding progress and preparing</span>
          <span className="block sm:inline"> the next step for your business.</span>
        </p>

        <div
          className="mx-auto mt-9 flex h-14 w-14 items-center justify-center rounded-full border-2 border-auth-line"
          role="status"
          aria-label="Checking onboarding status"
        >
          <span
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-auth-gold border-r-auth-gold"
          />
        </div>

        <ul
          aria-label="Onboarding checks"
          className="mx-auto mt-9 flex max-w-sm flex-col gap-5 text-left"
        >
          {onboardingChecks.map((check) => (
            <li key={check.label} className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  check.state === "active" ? "border-dashed border-auth-gold" : "border-auth-line"
                }`}
              >
                {check.state === "active" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-auth-gold" />
                ) : null}
              </span>
              <span
                className={
                  check.state === "active"
                    ? "text-sm text-auth-text"
                    : "text-sm text-auth-dark-muted"
                }
              >
                {check.label}
              </span>
            </li>
          ))}
        </ul>

        <div className="mx-auto mt-10 max-w-sm border-t border-auth-line pt-6">
          <p className="text-sm text-auth-dark-muted">
            You&apos;ll continue automatically when your status is ready.
          </p>
          <Link
            href="/onboarding"
            className="mx-auto mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-full border border-auth-line px-6 text-sm font-medium text-auth-text transition-colors hover:bg-auth-hover focus-visible:bg-auth-hover"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Refresh status
          </Link>
        </div>

        <p className="mt-8 text-xs text-auth-dark-muted">
          Need help? <span className="text-auth-link">Contact support</span>
        </p>
      </div>
    </div>
  );
}
