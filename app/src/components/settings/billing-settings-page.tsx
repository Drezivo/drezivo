"use client";

import { useAuth } from "@clerk/nextjs";
import { Receipt, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { BillingOverview } from "@drezivo/contracts";

import { useRequestPlanUpgrade } from "@/components/billing/plan-upgrade-dialog";
import { PaymentHistory } from "@/components/billing/subscribe-dialog";
import { accessMessage, useOpenSubscribe } from "@/components/billing/subscription-status";
import { ErrorState, LoadingState, Section } from "@/components/forms/form-kit";
import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { Button } from "@/components/ui/button";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; billing: BillingOverview };

const peso = (minor: string) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: Number(minor) % 100 === 0 ? 0 : 2,
  }).format(Number(minor) / 100);
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

/**
 * Settings → Plan & billing: the workspace's plan, how much of it is used, and its payments.
 * Everyone can read it; only the owner gets the actions (the API enforces the same).
 */
export function BillingSettingsPage() {
  const { getToken } = useAuth();
  const actor = useVerifiedActorContext();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Starting a trial or sending a payment refreshes the actor context; reload the page with it.
  const subscriptionKey = actor
    ? `${actor.subscription.plan_code}:${actor.subscription.status}:${actor.access.reason}:${actor.access.pending_payment}`
    : "";

  useEffect(() => {
    let active = true;
    setLoad((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    createDrezivoApiClient(getToken)
      .getBilling()
      .then((result) => {
        if (active) setLoad({ kind: "ready", billing: result.data });
      })
      .catch((error: unknown) => {
        if (active)
          setLoad({
            kind: "error",
            message: error instanceof DrezivoApiError ? error.message : "Could not load your plan.",
          });
      });
    return () => {
      active = false;
    };
  }, [getToken, reloadKey, subscriptionKey]);

  if (load.kind === "loading") return <LoadingState label="Loading your plan…" />;
  if (load.kind === "error") {
    return <ErrorState message={load.message} onRetry={() => setReloadKey((key) => key + 1)} />;
  }
  const { billing } = load;

  return (
    <div className="grid gap-6">
      <CurrentPlan billing={billing} />
      {billing.payments.length > 0 ? (
        <Section icon={Receipt} title="Payments" description="Payments you sent to Drezivo, newest first.">
          <PaymentHistory payments={billing.payments} />
        </Section>
      ) : null}
    </div>
  );
}

function CurrentPlan({ billing }: { billing: BillingOverview }) {
  const requestUpgrade = useRequestPlanUpgrade();
  const openSubscribe = useOpenSubscribe();
  const { plan, subscription, access, usage } = billing;
  const message = accessMessage(access);
  const onFree = plan.code === "free";
  const pending = access.pending_payment;
  const atGarmentLimit = usage !== undefined && usage.active_garments >= plan.physical_assets_max;
  const endLabel =
    subscription.status === "trialing" && subscription.trial_ends_at
      ? { term: "Trial ends", iso: subscription.trial_ends_at }
      : !onFree && subscription.current_period_end
        ? { term: "Paid through", iso: subscription.current_period_end }
        : null;

  return (
    <Section icon={Sparkles} title={`${plan.name} plan`} description={message.body || undefined}>
      <dl className="divide-y divide-dashboard-border border-y border-dashboard-border text-sm">
        <Fact term="Price">{onFree ? "Free" : `${peso(plan.monthly_minor)} a month`}</Fact>
        <Fact term="Status">{onFree ? "Active, no end date" : message.title}</Fact>
        {endLabel ? <Fact term={endLabel.term}>{longDate(endLabel.iso)}</Fact> : null}
        <Fact term="Active garments">
          <Usage used={usage?.active_garments} limit={plan.physical_assets_max} />
        </Fact>
        <Fact term="Front Desk staff">
          {plan.frontdesk_seats_max === 0 && !usage?.frontdesk_seats_used ? (
            "Owner only"
          ) : (
            <Usage used={usage?.frontdesk_seats_used} limit={plan.frontdesk_seats_max} />
          )}
        </Fact>
      </dl>

      {atGarmentLimit && onFree ? (
        <p className="mt-4 text-sm text-dashboard-muted">
          You have reached the Free limit of {plan.physical_assets_max} active garments. Upgrade to add more.
        </p>
      ) : null}

      {billing.can_pay ? (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onFree && !pending ? (
            <Button type="button" className="min-h-11" onClick={() => requestUpgrade()}>
              {billing.can_start_trial ? "Try a paid plan free for 14 days" : "Upgrade"}
            </Button>
          ) : (
            <Button type="button" className="min-h-11" onClick={openSubscribe}>
              {pending ? "Payment status" : `Pay for ${plan.name}`}
            </Button>
          )}
          {onFree && !pending ? null : (
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => requestUpgrade()}>
              Compare plans
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-dashboard-muted">
          Only the business owner can change the plan or pay for it.
        </p>
      )}
    </Section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-dashboard-muted">{term}</dt>
      <dd className="min-w-0 text-right font-medium text-dashboard-navy">{children}</dd>
    </div>
  );
}

/** "12 of 20" with a hairline meter; just the limit when an older API sent no usage. */
function Usage({ used, limit }: { used: number | undefined; limit: number }) {
  if (used === undefined) return <>Up to {limit}</>;
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <span className="inline-flex flex-col items-end gap-1.5">
      <span className="tabular-nums">
        {used} of {limit}
      </span>
      <span
        aria-hidden="true"
        className="block h-1 w-24 overflow-hidden rounded-full bg-dashboard-border"
      >
        <span
          className={`block h-full rounded-full ${share >= 1 ? "bg-dashboard-danger" : "bg-dashboard-accent"}`}
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}
