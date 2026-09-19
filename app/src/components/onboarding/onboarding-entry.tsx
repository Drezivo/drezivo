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

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { ExitOnboardingDialog } from "@/components/onboarding/exit-onboarding-dialog";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { RestartOnboardingDialog } from "@/components/onboarding/restart-onboarding-dialog";
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
      <OnboardingFrame getToken={getToken} onboarding={null}>
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
      <OnboardingFrame getToken={getToken} onboarding={null}>
        <OrganizationSetup
          getToken={getToken}
          onCreated={() => {
            router.replace("/onboarding/plan");
          }}
          setActive={setActive}
        />
      </OnboardingFrame>
    );
  }

  if (onboarding?.status === "payment_pending") {
    return (
      <OnboardingFrame getToken={getToken} onboarding={onboarding}>
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
      <OnboardingFrame getToken={getToken} onboarding={onboarding}>
        <StatusCard
          action={
            <div className="space-y-3">
              <Link href="/onboarding/plan" className={primaryButtonClass}>
                Continue setup
              </Link>
              <RestartOnboardingDialog
                getToken={getToken}
                onboarding={onboarding}
                onRestarted={loadCurrent}
                triggerClassName={secondaryButtonClass}
              />
            </div>
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
      <OnboardingFrame getToken={getToken} onboarding={null}>
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
    <OnboardingFrame getToken={getToken} onboarding={null}>
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
    <section aria-labelledby="onboarding-heading" className="mx-auto w-full max-w-lg py-6 sm:py-8">
      <div className="text-center">
        <AuthBrand />
        <p className="mt-2 text-xs font-medium tracking-[0.35em] text-auth-dark-muted">
          FOR PROFESSIONALS
        </p>
      </div>

      <div className="mt-8">
        <OnboardingProgress current="organization" />
      </div>

      <div className="mt-9 text-center">
        <h1 id="onboarding-heading" className="font-display text-3xl leading-tight text-auth-text sm:text-4xl">
          Set up your business
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-auth-dark-muted">
          Tell us what your rental business is called to create your workspace.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-7 rounded-lg border border-auth-error/50 bg-auth-error/10 px-4 py-3 text-sm text-auth-error"
        >
          <p>{error.message}</p>
          {error.requestId && <p className="mt-1 text-xs">Support reference: {error.requestId}</p>}
        </div>
      )}

      <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="organization-name" className="text-sm font-semibold text-auth-text">
            Business name
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
          <label htmlFor="organization-slug" className="text-sm font-semibold text-auth-text">
            Slug <span className="font-normal text-auth-dark-muted">(optional)</span>
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
          <p className="mt-2 text-xs text-auth-dark-muted">
            Lowercase letters, numbers, and hyphens only.
          </p>
        </div>
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? "Creating workspace…" : "Continue"}
        </button>
      </form>

      <div className="mt-7 border-t border-auth-line pt-6 text-center">
        <p className="text-sm text-auth-dark-muted">
          Need help? <span className="font-medium text-auth-gold">Contact support</span>
        </p>
      </div>
    </section>
  );
}

function OnboardingFrame({
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
      backHref="/sign-up"
      backAriaLabel="Back to sign up"
      panelAriaLabel="Drezivo business onboarding"
      lockViewport
      backControl={
        getToken ? <ExitOnboardingDialog getToken={getToken} onboarding={onboarding ?? null} /> : undefined
      }
    >
      <div className="flex flex-1 items-center">{children}</div>
    </AuthSplitLayout>
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
    <section className="mx-auto w-full max-w-xl py-8 text-center sm:py-10">
      <AuthBrand />
      <p className="mt-2 text-xs font-medium tracking-[0.35em] text-auth-dark-muted">
        FOR PROFESSIONALS
      </p>
      <div className="mt-10">
        <OnboardingProgress current="organization" />
      </div>
      <h1 className="mt-12 font-display text-4xl leading-tight text-auth-text">{title}</h1>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-auth-dark-muted">{description}</p>
      {requestId && (
        <p className="mt-3 text-xs text-auth-dark-muted">Support reference: {requestId}</p>
      )}
      <div className="mt-8">{action}</div>
      <div className="mt-8 border-t border-auth-line pt-7">
        <p className="text-sm text-auth-dark-muted">
          Need help? <span className="font-medium text-auth-gold">Contact support</span>
        </p>
      </div>
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
  "mt-2 h-10 w-full rounded-lg border border-auth-line bg-transparent px-3.5 text-sm text-auth-text outline-none transition placeholder:text-auth-dark-muted focus:border-auth-gold focus:ring-2 focus:ring-auth-gold/20";
const primaryButtonClass =
  "inline-flex min-h-10 w-full items-center justify-center rounded-full bg-auth-button px-5 text-sm font-semibold text-auth-button-ink transition hover:bg-auth-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full border border-auth-line bg-transparent px-6 text-sm font-semibold text-auth-text transition hover:border-auth-gold hover:text-auth-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-focus focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel disabled:cursor-not-allowed disabled:opacity-60";
