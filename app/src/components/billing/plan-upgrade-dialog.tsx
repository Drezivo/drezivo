"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, CheckCircle2, Loader2, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type {
  BillingOverview,
  PlanCode,
  PublicPlanCatalogResponse,
  SubscriptionSummary,
} from "@drezivo/contracts";
import { READ_ONLY_ACCESS_DAYS } from "@drezivo/contracts";

import { SubscribeDialog } from "@/components/billing/subscribe-dialog";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

/** Opens the plan picker. Pass the locked feature's name when a gate opened it; omit it otherwise. */
type RequestPlanUpgrade = (feature?: string) => void;

const UpgradeContext = createContext<RequestPlanUpgrade>(() => undefined);
export const useRequestPlanUpgrade = () => useContext(UpgradeContext);

type CatalogPlan = PublicPlanCatalogResponse["plans"][number];

const formatPrice = (minor: number) =>
  `₱${(minor / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

function planSummary(plan: CatalogPlan): string {
  const staff =
    plan.limits.frontdesk_seats > 0
      ? `${plan.limits.frontdesk_seats} Front Desk staff`
      : "owner only";
  return [
    `${plan.limits.active_garments.toLocaleString("en-PH")} active garments`,
    staff,
    plan.features.fittings ? "fittings" : "no fittings",
    plan.features.storefront_reservations ? "online bookings" : "availability only",
    `${plan.features.storefront_themes.length} storefront designs`,
  ].join(" · ");
}

/**
 * The plan picker. A Free owner starts the paid plan's 14-day trial here while their one lifetime
 * trial is unused, and otherwise pays for the plan (it opens once Drezivo approves the payment).
 * Workspaces already on a paid plan see their plan; moving between paid plans is not offered.
 */
export function PlanUpgradeProvider({
  children,
  onChanged,
}: {
  children: React.ReactNode;
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PublicPlanCatalogResponse | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [targetPlan, setTargetPlan] = useState<PlanCode>("starter");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [startedTrial, setStartedTrial] = useState<SubscriptionSummary | null>(null);
  const submit = useSubmitGuard();

  const openUpgrade = useCallback<RequestPlanUpgrade>((requestedFeature) => {
    setFeature(requestedFeature ?? null);
    setActionError(null);
    setStartedTrial(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setIsLoading(true);
    const api = createDrezivoApiClient(getToken);
    Promise.all([api.getPublicPlanCatalog(), api.getBilling()])
      .then(([result, billingResult]) => {
        if (!active) return;
        setCatalog(result.data);
        setBilling(billingResult.data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "Could not load plans.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getToken, open]);

  async function startTrial() {
    if (submit.isSubmitting) return;
    setActionError(null);
    try {
      const result = await submit.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).changeSubscriptionPlan(
          { plan_code: targetPlan },
          idempotencyKey
        )
      );
      if (!result) return;
      setStartedTrial(result.data);
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof DrezivoApiError ? error.message : "Could not start the trial. Try again."
      );
    }
  }

  const plans = catalog?.plans.filter((plan) => plan.code !== "free") ?? [];
  const chosen = plans.find((plan) => plan.code === targetPlan) ?? null;
  const onFree = billing?.plan.code === "free";
  const pendingPayment = billing?.payments.some((payment) => payment.status === "pending") ?? false;

  const title = startedTrial
    ? "Your trial has started"
    : feature
      ? "Upgrade to unlock"
      : "Choose a plan";
  const description = startedTrial
    ? "Every feature of the plan is open now."
    : feature
      ? `${feature} is not included in ${billing ? `the ${billing.plan.name} plan` : "your current plan"}.`
      : "Paid plans add online bookings, fittings, and room for more garments.";

  return (
    <UpgradeContext.Provider value={openUpgrade}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] max-h-[90svh] overflow-y-auto rounded-t-2xl border border-dashboard-border bg-dashboard-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-dashboard-navy shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Dialog.Title className="font-display text-2xl">{title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-dashboard-muted">
                  {description}
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded-md p-1.5 text-dashboard-muted hover:bg-dashboard-active" aria-label="Close">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            {startedTrial ? (
              <TrialStarted
                summary={startedTrial}
                planName={chosen?.name ?? "Your plan"}
                onDone={() => setOpen(false)}
              />
            ) : isLoading ? (
              <p className="flex items-center gap-2 py-9 text-sm text-dashboard-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
              </p>
            ) : loadError ? (
              <p role="alert" className="py-6 text-sm text-red-600">{loadError}</p>
            ) : billing ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2" role={onFree ? "radiogroup" : undefined} aria-label={onFree ? "Paid plans" : undefined}>
                  {plans.map((plan) => {
                    const current = billing.plan.code === plan.code;
                    const selected = onFree && targetPlan === plan.code;
                    return (
                      <button
                        key={plan.code}
                        type="button"
                        role={onFree ? "radio" : undefined}
                        aria-checked={onFree ? selected : undefined}
                        disabled={!onFree}
                        onClick={() => {
                          setTargetPlan(plan.code);
                          submit.resetIntent();
                          setActionError(null);
                        }}
                        className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent disabled:cursor-default ${selected || current ? "border-dashboard-accent bg-dashboard-active/60" : "border-dashboard-border enabled:hover:bg-dashboard-canvas"}`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span>
                            <span className="block font-semibold">
                              {plan.name}
                              {current ? <span className="ml-2 text-xs font-medium text-dashboard-accent">Your plan</span> : null}
                            </span>
                            <span className="mt-1 block text-sm text-dashboard-muted">{formatPrice(plan.monthly_price_minor)} / month</span>
                          </span>
                          {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-dashboard-accent" aria-hidden="true" /> : null}
                        </span>
                        <span className="mt-3 block text-xs leading-5 text-dashboard-muted">{planSummary(plan)}</span>
                      </button>
                    );
                  })}
                </div>

                {onFree ? (
                  <FreeOwnerActions
                    billing={billing}
                    plan={chosen}
                    pendingPayment={pendingPayment}
                    isSubmitting={submit.isSubmitting}
                    actionError={actionError}
                    onStartTrial={() => void startTrial()}
                    onPay={() => {
                      setOpen(false);
                      setPaymentOpen(true);
                    }}
                  />
                ) : (
                  <p className="mt-5 border-t border-dashboard-border pt-4 text-sm text-dashboard-muted">
                    Your workspace is on {billing.plan.name}. Moving between paid plans is not
                    available in the app yet; ask Drezivo through the{" "}
                    <Link href="/help" className="font-medium text-dashboard-accent underline underline-offset-4" onClick={() => setOpen(false)}>
                      Help Center
                    </Link>
                    .
                  </p>
                )}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SubscribeDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        targetPlanCode={targetPlan}
        onSubmitted={onChanged}
      />
    </UpgradeContext.Provider>
  );
}

function FreeOwnerActions({
  billing,
  plan,
  pendingPayment,
  isSubmitting,
  actionError,
  onStartTrial,
  onPay,
}: {
  billing: BillingOverview;
  plan: CatalogPlan | null;
  pendingPayment: boolean;
  isSubmitting: boolean;
  actionError: string | null;
  onStartTrial: () => void;
  onPay: () => void;
}) {
  if (!billing.can_pay) {
    return (
      <p className="mt-5 border-t border-dashboard-border pt-4 text-sm text-dashboard-muted">
        Only the business owner can change the plan.
      </p>
    );
  }
  if (pendingPayment) {
    return (
      <div className="mt-5 flex flex-col gap-3 border-t border-dashboard-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-dashboard-muted">Your payment is waiting for Drezivo to approve it.</p>
        <Button type="button" variant="secondary" onClick={onPay}>
          Payment status
        </Button>
      </div>
    );
  }

  const name = plan?.name ?? "the plan";
  const note = billing.can_start_trial
    ? `No payment now. Pay before the 14 days end to keep ${name}; otherwise the workspace becomes view-only for ${READ_ONLY_ACCESS_DAYS} days and then locks. Your data is kept either way.`
    : `You have already used your free trial, so ${name} opens once Drezivo approves your payment.`;

  return (
    <div className="mt-5 grid gap-3 border-t border-dashboard-border pt-4">
      <p className="text-sm text-dashboard-muted">{note}</p>
      {actionError ? <p role="alert" className="text-sm text-red-600">{actionError}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {billing.can_start_trial ? (
          <Button type="button" disabled={!plan || isSubmitting} onClick={onStartTrial}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Start 14-day {plan?.name ?? ""} trial <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" disabled={!plan} onClick={onPay}>
            Continue to payment <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function TrialStarted({
  summary,
  planName,
  onDone,
}: {
  summary: SubscriptionSummary;
  planName: string;
  onDone: () => void;
}) {
  return (
    <div className="mt-6 grid gap-5" role="status">
      <p className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-dashboard-green-text" aria-hidden="true" />
        <span>
          {planName} is yours to try
          {summary.trial_ends_at ? ` until ${longDate(summary.trial_ends_at)}` : ""}. Pay any time
          before then from Settings, Plan &amp; billing to keep it.
        </span>
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
