"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import type { ActorContext } from "@drezivo/contracts";
import { useEffect, useMemo, useState } from "react";

import { DashboardHeader } from "@/components/shell/dashboard-header";
import { DashboardSidebar } from "@/components/shell/dashboard-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

export interface DashboardIdentity {
  businessName: string;
  roleLabel: string;
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
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);

  useEffect(() => {
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
  }, [getToken]);

  const identity = useMemo<DashboardIdentity>(() => {
    const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    return {
      businessName: actorContext?.tenant.name ?? "",
      roleLabel: roleLabel(actorContext?.membership.role),
      ...(user?.imageUrl ? { userImageUrl: user.imageUrl } : {}),
      userName:
        user?.fullName || clerkName || user?.primaryEmailAddress?.emailAddress || "Account",
    };
  }, [actorContext, user]);

  useEffect(() => {
    // Theme switching is intentionally disabled for now; the dashboard always uses dark mode.
    document.documentElement.dataset["dashboardTheme"] = "dark";

    return () => {
      delete document.documentElement.dataset["dashboardTheme"];
    };
  }, []);

  return (
    <SidebarProvider className="dashboard-theme-dark h-svh min-h-0 overflow-hidden">
      <DashboardSidebar identity={identity} />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <DashboardHeader identity={identity} />
        {/* `relative` makes this scroller the containing block for absolutely positioned content (such as
            visually hidden inputs), so focusing them scrolls this pane instead of shifting the whole shell. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto bg-dashboard-canvas">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
