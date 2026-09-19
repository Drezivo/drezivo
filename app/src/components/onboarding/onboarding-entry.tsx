"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

import {
  createOwnerOnboardingRequest,
  type OnboardingActorContext,
  type OrganizationOnboarding,
} from "@drezivo/contracts";

import { OnboardingStatusPage } from "@/components/onboarding/onboarding-status-page";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "ready"; context: OnboardingActorContext };

export function OnboardingEntry() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const loadCurrent = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setState({ kind: "loading" });
    try {
      const result = await createDrezivoApiClient(getToken).getCurrentOnboarding();
      setState({ kind: "ready", context: result.data });
    } catch (caughtError) {
      setState({ kind: "error", error: toDrezivoApiError(caughtError) });
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in");
      return;
    }

    void loadCurrent();
  }, [isLoaded, isSignedIn, loadCurrent, router]);

  if (!isLoaded || !isSignedIn || state.kind === "loading") {
    return <LoadingState />;
  }

  if (state.kind === "error") {
    return (
      <OnboardingFrame>
        <StatusCard
          action={
            <button type="button" onClick={() => void loadCurrent()} className={primaryButtonClass}>
              Try again
            </button>
          }
          description={state.error.message}
          requestId={state.error.requestId}
          title="We could not load your setup"
        />
      </OnboardingFrame>
    );
  }

  const { context } = state;
  const onboarding = context.onboarding;

  if (!onboarding && !context.has_current_owned_tenant) {
    return (
      <OnboardingFrame>
        <OrganizationSetup
          getToken={getToken}
          onCreated={() => {
            router.replace("/onboarding");
            void loadCurrent();
          }}
          setActive={setActive}
        />
      </OnboardingFrame>
    );
  }

  if (onboarding?.status === "payment_pending") {
    return (
      <OnboardingFrame>
        <StatusCard
          action={
            <button type="button" onClick={() => void loadCurrent()} className={primaryButtonClass}>
              Refresh status
            </button>
          }
          description="Our operator team is verifying your payment. Return here to check for the next onboarding update."
          title="Payment verification and operator handoff pending"
        />
      </OnboardingFrame>
    );
  }

  if (onboarding?.status === "incomplete") {
    return (
      <OnboardingFrame>
        <StatusCard
          action={
            <Link href="/onboarding" className={primaryButtonClass}>
              Continue setup
            </Link>
          }
          description={`${onboarding.requested_slug ? `Requested slug: ${onboarding.requested_slug}. ` : ""}${
            onboarding.selected_plan_code
              ? "Your organization is saved and ready for the next setup step."
              : "Your organization is saved. Plan selection will be the next step."
          }`}
          title={`Continue setting up ${onboarding.organization_name}`}
        />
      </OnboardingFrame>
    );
  }

  if (
    onboarding?.status === "provisioned" ||
    onboarding?.status === "abandoned" ||
    context.has_current_owned_tenant
  ) {
    return (
      <OnboardingFrame>
        <StatusCard
          action={
            <button
              type="button"
              onClick={() => router.replace("/")}
              className={primaryButtonClass}
            >
              Go to dashboard
            </button>
          }
          description="Your workspace is ready. We will resolve the active workspace before loading operational tools."
          title="Your Drezivo workspace is ready"
        />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame>
      <StatusCard
        action={
          <button type="button" onClick={() => void loadCurrent()} className={primaryButtonClass}>
            Try again
          </button>
        }
        description="The setup state is not ready for the next step yet."
        title="Setup needs attention"
      />
    </OnboardingFrame>
  );
}

function OrganizationSetup({
  getToken,
  onCreated,
  setActive,
}: {
  getToken: () => Promise<string | null>;
  onCreated: () => void;
  setActive: (params: { organization: string }) => Promise<unknown>;
}) {
  const api = createDrezivoApiClient(getToken);
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [organizationName, setOrganizationName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<DrezivoApiError | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const input = {
      organization_name: organizationName.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
    };
    const parsed = createOwnerOnboardingRequest.safeParse(input);
    if (!parsed.success) {
      setError(
        new DrezivoApiError(parsed.error.issues[0]?.message ?? "Check your organization details.", {
          status: 422,
        })
      );
      return;
    }

    setError(null);
    try {
      const result = await submit((idempotencyKey) =>
        api.createOnboarding(parsed.data, idempotencyKey)
      );
      if (!result) return;

      await setActive({ organization: result.data.clerk_org_id });
      resetIntent();
      onCreated();
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError));
    }
  }

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="w-full max-w-xl rounded-2xl border border-dashboard-border bg-dashboard-surface p-6 shadow-sm sm:p-8"
    >
      <ProgressIndicator current="organization" />
      <div className="mt-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-dashboard-accent">
          Your workspace
        </p>
        <h1
          id="onboarding-heading"
          className="mt-3 text-3xl font-semibold tracking-tight text-dashboard-navy"
        >
          Set up your business
        </h1>
        <p className="mt-3 text-sm leading-6 text-dashboard-muted">
          Tell us the name of the clothing-rental business you want to manage in Drezivo.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-dashboard-danger/30 bg-red-50 px-4 py-3 text-sm text-dashboard-danger"
        >
          <p>{error.message}</p>
          {error.requestId && <p className="mt-1 text-xs">Support reference: {error.requestId}</p>}
        </div>
      )}

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="organization-name" className="text-sm font-medium text-dashboard-navy">
            Organization name
          </label>
          <input
            id="organization-name"
            name="organization_name"
            value={organizationName}
            onChange={(event) => {
              resetIntent();
              setOrganizationName(event.target.value);
            }}
            autoComplete="organization"
            required
            maxLength={160}
            className={inputClass}
            placeholder="Luna's Gown Rentals"
          />
        </div>
        <div>
          <label htmlFor="organization-slug" className="text-sm font-medium text-dashboard-navy">
            Workspace slug <span className="font-normal text-dashboard-muted">(optional)</span>
          </label>
          <input
            id="organization-slug"
            name="slug"
            value={slug}
            onChange={(event) => {
              resetIntent();
              setSlug(event.target.value);
            }}
            autoComplete="off"
            maxLength={100}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            className={inputClass}
            placeholder="lunas-gown-rentals"
          />
          <p className="mt-2 text-xs text-dashboard-muted">
            Use lowercase letters, numbers, and hyphens.
          </p>
        </div>
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? "Creating workspace…" : "Continue"}
        </button>
      </form>
    </section>
  );
}

function OnboardingFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-dashboard-canvas px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}

function ProgressIndicator({ current }: { current: "organization" }) {
  return (
    <ol
      aria-label="Onboarding progress"
      className="grid grid-cols-3 gap-2 text-center text-xs font-medium text-dashboard-muted"
    >
      {[
        ["organization", "Organization"],
        ["plan", "Plan"],
        ["launch", "Launch"],
      ].map(([step, label], index) => (
        <li key={step} className={step === current ? "text-dashboard-accent" : undefined}>
          <span className="flex items-center justify-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-current"
            >
              {index + 1}
            </span>
            <span>{label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function LoadingState() {
  return <OnboardingStatusPage />;
}

function StatusCard({
  action,
  description,
  requestId,
  title,
}: {
  action: React.ReactNode;
  description: string;
  requestId?: string | null;
  title: string;
}) {
  return (
    <section className="w-full max-w-xl rounded-2xl border border-dashboard-border bg-dashboard-surface p-8 shadow-sm">
      <ProgressIndicator current="organization" />
      <h1 className="mt-8 text-2xl font-semibold text-dashboard-navy">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-dashboard-muted">{description}</p>
      {requestId && (
        <p className="mt-3 text-xs text-dashboard-muted">Support reference: {requestId}</p>
      )}
      <div className="mt-8">{action}</div>
    </section>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not complete that request. Please try again.", {
    status: 500,
  });
}

const inputClass =
  "mt-2 h-12 w-full rounded-lg border border-dashboard-border bg-dashboard-canvas px-4 text-sm text-dashboard-navy outline-none transition focus:border-dashboard-accent focus:ring-2 focus:ring-dashboard-accent/20";
const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-dashboard-accent px-5 text-sm font-semibold text-white transition hover:bg-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
