"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import type { ActorContext } from "@drezivo/contracts";
import { useEffect, useMemo, useState } from "react";

import { useRefreshVerifiedActor, useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { SubscriptionBanner, SubscriptionProvider, SubscriptionWall } from "@/components/billing/subscription-status";
import { PendingHoldGuard } from "@/components/reservations/pending-hold-guard";
import { DashboardHeader } from "@/components/shell/dashboard-header";
import { DashboardSidebar } from "@/components/shell/dashboard-sidebar";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

export interface DashboardIdentity {
  businessName: string;
  businessLogoUrl?: string;
  roleLabel: string;
  userEmail: string;
  userImageUrl?: string;
  userName: string;
}

function roleLabel(role: ActorContext["membership"]["role"] | undefined) {
  // Unknown until the actor context loads: show nothing rather than a guessed role.
  if (!role) return "";
  if (role === "owner") return "Business Owner";
  if (role === "frontdesk") return "Front Desk";
  return "Team Member";
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const verifiedActor = useVerifiedActorContext();
  const [fetchedActor, setActorContext] = useState<ActorContext | null>(null);
  const [businessLogoUrl, setBusinessLogoUrl] = useState<string | null>(null);
  const actorContext = verifiedActor ?? fetchedActor;
  const access = actorContext?.access ?? null;
  const refreshActor = useRefreshVerifiedActor();

  useEffect(() => {
    // Inside the access gate the actor is already known; fetch only when rendered without it.
    if (verifiedActor) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const api = createDrezivoApiClient(getToken);

    // A transient failure (rate limit, network blip) is retried with backoff so the header does
    // not stay without the business name and role for the rest of the visit.
    const load = (attempt: number): void => {
      api
        .getActorContext()
        .then((result) => {
          if (active) setActorContext(result.data);
        })
        .catch(() => {
          if (active && attempt < 3) retry = setTimeout(() => load(attempt + 1), 1000 * 3 ** attempt);
        });
    };
    load(0);

    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [getToken, verifiedActor]);

  useEffect(() => {
    let active = true;
    const api = createDrezivoApiClient(getToken);
    const loadLogo = () => {
      void api
        .getStorefront()
        .then((result) => {
          if (active) setBusinessLogoUrl(result.data.media.logo_url);
        })
        .catch(() => {
          if (active) setBusinessLogoUrl(null);
        });
    };

    loadLogo();
    const onStorefrontUpdated = (event: Event) => {
      const logoUrl = (event as CustomEvent<{ logoUrl?: string | null }>).detail?.logoUrl;
      if (logoUrl !== undefined) setBusinessLogoUrl(logoUrl);
      else loadLogo();
    };
    window.addEventListener("drezivo:storefront-updated", onStorefrontUpdated);

    return () => {
      active = false;
      window.removeEventListener("drezivo:storefront-updated", onStorefrontUpdated);
    };
  }, [getToken]);

  const identity = useMemo<DashboardIdentity>(() => {
    const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    return {
      businessName: actorContext?.tenant.name ?? "",
      ...(businessLogoUrl ? { businessLogoUrl } : {}),
      roleLabel: roleLabel(actorContext?.membership.role),
      userEmail: user?.primaryEmailAddress?.emailAddress ?? "",
      ...(user?.imageUrl ? { userImageUrl: user.imageUrl } : {}),
      userName:
        user?.fullName || clerkName || user?.primaryEmailAddress?.emailAddress || "Account",
    };
  }, [actorContext, businessLogoUrl, user]);

  return (
    <SubscriptionProvider access={access} onChanged={refreshActor}>
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <DashboardSidebar identity={identity} />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <DashboardHeader identity={identity} />
        <SubscriptionBanner access={access} />
        {/* `relative` makes this scroller the containing block for absolutely positioned content (such as
            visually hidden inputs), so focusing them scrolls this pane instead of shifting the whole shell. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto bg-dashboard-canvas">
          {/* Locked after the 30 view-only days: every page shows the Subscribe wall. The API enforces it too. */}
          {access?.level === "locked" ? <SubscriptionWall access={access} /> : children}
        </main>
        {/* Phones only: thumb-reach tabs + Menu sheet, in the column so sticky save bars sit above it. */}
        <MobileTabBar identity={identity} />
        {/* Reopens a live garment hold after navigation or refresh; see components/reservations/pending-hold-guard.tsx. */}
        <PendingHoldGuard />
      </SidebarInset>
    </SidebarProvider>
    </SubscriptionProvider>
  );
}
