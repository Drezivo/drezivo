"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Clock, Lock, Receipt } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { SubscriptionAccess } from "@drezivo/contracts";

import { SubscribeDialog } from "@/components/billing/subscribe-dialog";
import { Button } from "@/components/ui/button";

/**
 * Pilot subscription UI for Starter and Standard. Every "Pay" action opens the Subscribe dialog.
 * After a trial or paid month ends the workspace is view-only for 30 days (the storefront stays
 * up, taking no bookings, for the first 3), then it locks until the owner pays.
 */

/** Fired by the API client when the server refuses an action because of the subscription. */
export const SUBSCRIPTION_REQUIRED_EVENT = "drezivo:subscription-required";

type Tone = "info" | "attention" | "blocked";

const plural = (days: number, word: string) => `${days} ${word}${days === 1 ? "" : "s"}`;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function inDays(days: number | null): string {
  if (days === null) return "";
  return days === 0 ? "today" : `in ${plural(days, "day")}`;
}

/** Plain-language status for the banner, prompt, wall, and dialog. */
export function accessMessage(access: SubscriptionAccess): {
  tone: Tone;
  title: string;
  body: string;
} {
  const pending = access.pending_payment ? " Your payment is waiting for approval." : "";
  const storefront = access.storefront_online
    ? access.storefront_offline_at
      ? ` Your storefront goes offline ${inDays(daysUntil(access.storefront_offline_at))}.`
      : " Your storefront is visible, but customers cannot book."
    : " Your storefront is offline.";
  const readOnlyEnds = access.read_only_until
    ? ` View-only access ends ${inDays(daysUntil(access.read_only_until))}.`
    : "";
  switch (access.reason) {
    case "trial":
      return {
        tone: "info",
        title: `Free trial: ${plural(access.days_left ?? 0, "day")} left`,
        body: `Subscribe any time to keep your workspace active.${pending}`,
      };
    case "trial_ending":
      return {
        tone: "attention",
        title: `Your free trial ends ${inDays(access.days_left)}`,
        body: `Subscribe to keep making changes and taking bookings.${pending}`,
      };
    case "renewal_due":
      return {
        tone: "attention",
        title: `Your subscription ends ${inDays(access.days_left)}`,
        body: `Submit payment to keep making changes and taking bookings.${pending}`,
      };
    case "paid":
      return { tone: "info", title: "Subscription active", body: pending.trim() };
    case "trial_ended":
    case "payment_overdue":
    case "trial_extension": {
      if (access.level === "locked") {
        return {
          tone: "blocked",
          title: "Your workspace is locked",
          body: `Subscribe to open your workspace and storefront again. Your data is kept safe.${pending}`,
        };
      }
      const title =
        access.reason === "trial_ended"
          ? "Your free trial has ended"
          : access.reason === "trial_extension"
            ? "View-only access"
            : "Your subscription has ended";
      return {
        tone: "attention",
        title,
        body: `You can view everything, but nothing can be changed.${storefront}${readOnlyEnds}${pending}`,
      };
    }
    case "cancelled":
      return {
        tone: "blocked",
        title: "Your subscription is cancelled",
        body: `Subscribe again to reopen your workspace.${pending}`,
      };
  }
}

const TONE_CLASS: Record<Tone, string> = {
  info: "border-dashboard-border bg-dashboard-surface text-dashboard-navy",
  attention: "border-amber-400/40 bg-amber-500/10 text-dashboard-navy",
  blocked: "border-red-400/40 bg-red-500/10 text-dashboard-navy",
};

const SubscribeContext = createContext<() => void>(() => undefined);
/** Opens the Subscribe dialog from anywhere inside the dashboard. */
export const useOpenSubscribe = () => useContext(SubscribeContext);

/**
 * Owns the Subscribe dialog, the view-only prompt, and the banner for the dashboard shell.
 * `onChanged` reloads the actor context after a payment is submitted.
 */
export function SubscriptionProvider({
  access,
  onChanged,
  children,
}: {
  access: SubscriptionAccess | null;
  onChanged: () => void;
  children: React.ReactNode;
}) {
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const openSubscribe = useCallback(() => setSubscribeOpen(true), []);
  return (
    <SubscribeContext.Provider value={openSubscribe}>
      {children}
      <SubscriptionPrompt access={access} onPay={openSubscribe} />
      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        onSubmitted={onChanged}
      />
    </SubscribeContext.Provider>
  );
}

/** A slim strip under the header whenever the owner should act. A running trial or paid month shows nothing. */
export function SubscriptionBanner({ access }: { access: SubscriptionAccess | null }) {
  const openSubscribe = useOpenSubscribe();
  if (!access) return null;
  const quiet = (access.reason === "trial" || access.reason === "paid") && !access.pending_payment;
  if (quiet || access.level === "locked") return null;
  const message = accessMessage(access);
  const Icon = access.level === "read_only" ? Lock : Clock;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6 lg:px-8 ${TONE_CLASS[message.tone]}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{message.title}.</span>{" "}
        <span className="text-dashboard-muted">{message.body}</span>
      </p>
      <button
        type="button"
        onClick={openSubscribe}
        className="shrink-0 text-sm font-semibold text-dashboard-accent underline underline-offset-4"
      >
        {access.pending_payment ? "Payment status" : "Subscribe"}
      </button>
    </div>
  );
}

/**
 * View-only mode asks to subscribe on every page the owner opens, and whenever the server refuses a
 * change because of the subscription. It can be dismissed, but it comes back.
 */
function SubscriptionPrompt({
  access,
  onPay,
}: {
  access: SubscriptionAccess | null;
  onPay: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const readOnly = access?.level === "read_only";

  useEffect(() => {
    if (readOnly) setOpen(true);
  }, [pathname, readOnly]);

  useEffect(() => {
    const onRequired = () => setOpen(true);
    window.addEventListener(SUBSCRIPTION_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(SUBSCRIPTION_REQUIRED_EVENT, onRequired);
  }, []);

  const message = useMemo(() => (access ? accessMessage(access) : null), [access]);
  if (!access || !message || access.level === "locked") return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-dashboard-border bg-dashboard-surface p-6 text-dashboard-navy shadow-2xl outline-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <Dialog.Title className="mt-4 font-display text-2xl">{message.title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-dashboard-muted">
            {message.body}
          </Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                Not now
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                onPay();
              }}
            >
              <Receipt className="mr-2 h-4 w-4" />{" "}
              {access.pending_payment ? "Payment status" : "Subscribe"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shown instead of every page once the 30 view-only days are over (or the subscription is cancelled). */
export function SubscriptionWall({ access }: { access: SubscriptionAccess }) {
  const openSubscribe = useOpenSubscribe();
  const message = accessMessage(access);
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-dashboard-border bg-dashboard-surface p-7 text-center sm:p-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-3xl text-dashboard-navy">{message.title}</h1>
        <p className="mt-3 text-sm leading-6 text-dashboard-muted">{message.body}</p>
        <Button type="button" className="mt-7" onClick={openSubscribe}>
          <Receipt className="mr-2 h-4 w-4" />{" "}
          {access.pending_payment ? "See payment status" : "Subscribe"}
        </Button>
      </section>
    </div>
  );
}
