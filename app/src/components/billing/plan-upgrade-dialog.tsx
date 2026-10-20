"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, CheckCircle2, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type { BillingOverview, PlanCode, PublicPlanCatalogResponse } from "@drezivo/contracts";

import { SubscribeDialog } from "@/components/billing/subscribe-dialog";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

const UpgradeContext = createContext<(feature?: string) => void>(() => undefined);
export const useRequestPlanUpgrade = () => useContext(UpgradeContext);

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
  const [feature, setFeature] = useState("this feature");
  const [catalog, setCatalog] = useState<PublicPlanCatalogResponse | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [targetPlan, setTargetPlan] = useState<PlanCode>("starter");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const submit = useSubmitGuard();

  const openUpgrade = useCallback((requestedFeature = "this feature") => {
    setFeature(requestedFeature);
    setActionError(null);
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
      setOpen(false);
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof DrezivoApiError
          ? error.message
          : "Could not start the trial. You can submit a manual payment instead."
      );
    }
  }

  const plans = catalog?.plans.filter((plan) => plan.code !== "free") ?? [];
  const formatPrice = (minor: number) =>
    `₱${(minor / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

  return (
    <UpgradeContext.Provider value={openUpgrade}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] max-h-[90svh] overflow-y-auto rounded-t-2xl border border-dashboard-border bg-dashboard-surface p-5 text-dashboard-navy shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-2xl">Upgrade to unlock</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-dashboard-muted">
                  {feature} is not included in Free. Choose a paid plan to continue.
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded-md p-1.5 text-dashboard-muted hover:bg-dashboard-active" aria-label="Close">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            {isLoading ? (
              <p className="flex items-center gap-2 py-9 text-sm text-dashboard-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</p>
            ) : loadError ? (
              <p role="alert" className="py-6 text-sm text-red-600">{loadError}</p>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => (
                  <button
                    key={plan.code}
                    type="button"
                    aria-pressed={targetPlan === plan.code}
                    onClick={() => {
                      setTargetPlan(plan.code);
                      submit.resetIntent();
                      setActionError(null);
                    }}
                    className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent ${targetPlan === plan.code ? "border-dashboard-accent bg-dashboard-active/60" : "border-dashboard-border hover:bg-dashboard-canvas"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block font-semibold">{plan.name}</span>
                        <span className="mt-1 block text-sm text-dashboard-muted">{formatPrice(plan.monthly_price_minor)} / month</span>
                      </span>
                      {targetPlan === plan.code ? <CheckCircle2 className="h-5 w-5 text-dashboard-accent" /> : null}
                    </span>
                    <span className="mt-3 block text-xs leading-5 text-dashboard-muted">
                      {plan.limits.active_garments} active garments · {plan.features.fittings ? "fittings" : "no fittings"} · {plan.features.storefront_reservations ? "online reservations" : "availability only"} · {plan.features.storefront_themes.length} designs
                    </span>
                  </button>
                ))}
              </div>
            )}

            {actionError ? <p role="alert" className="mt-4 text-sm text-red-600">{actionError}</p> : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {!billing?.can_start_trial ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isLoading || plans.length === 0 || !billing}
                  onClick={() => {
                    setOpen(false);
                    setPaymentOpen(true);
                  }}
                >
                  Submit payment
                </Button>
              ) : null}
              {billing?.can_start_trial ? (
                <Button type="button" disabled={isLoading || plans.length === 0 || submit.isSubmitting} onClick={() => void startTrial()}>
                  {submit.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Start 14-day trial <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SubscribeDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        targetPlanCode={targetPlan}
        onSubmitted={() => {
          onChanged();
          setPaymentOpen(false);
        }}
      />
    </UpgradeContext.Provider>
  );
}
