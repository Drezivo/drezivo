"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import type { ActorContext } from "@drezivo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardHeader } from "@/components/shell/dashboard-header";
import { DashboardSidebar } from "@/components/shell/dashboard-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

export type DashboardTheme = "light" | "dark";

export interface DashboardIdentity {
  businessName: string;
  roleLabel: string;
  userImageUrl?: string;
  userName: string;
}

const DASHBOARD_THEME_STORAGE_KEY = "drezivo.dashboard.theme";

function roleLabel(role: ActorContext["membership"]["role"] | undefined) {
  if (role === "owner") return "Business Owner";
  if (role === "frontdesk") return "Front Desk";
  return "Team Member";
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [theme, setTheme] = useState<DashboardTheme>("dark");
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);

  useEffect(() => {
    let active = true;
    const api = createDrezivoApiClient(getToken);

    void api
      .getActorContext()
      .then((result) => {
        if (active) setActorContext(result.data);
      })
      .catch(() => {
        if (active) setActorContext(null);
      });

    return () => {
      active = false;
    };
  }, [getToken]);

  const identity = useMemo<DashboardIdentity>(() => {
    const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    return {
      businessName: actorContext?.tenant.name ?? "Workspace",
      roleLabel: roleLabel(actorContext?.membership.role),
      ...(user?.imageUrl ? { userImageUrl: user.imageUrl } : {}),
      userName:
        user?.fullName || clerkName || user?.primaryEmailAddress?.emailAddress || "Account",
    };
  }, [actorContext, user]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY);
    const resolvedTheme: DashboardTheme = storedTheme === "light" ? "light" : "dark";
    setTheme(resolvedTheme);
    document.documentElement.dataset["dashboardTheme"] = resolvedTheme;

    return () => {
      delete document.documentElement.dataset["dashboardTheme"];
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => {
      const nextTheme: DashboardTheme = currentTheme === "dark" ? "light" : "dark";
      window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, nextTheme);
      document.documentElement.dataset["dashboardTheme"] = nextTheme;
      return nextTheme;
    });
  }, []);

  return (
    <SidebarProvider
      className={`h-svh min-h-0 overflow-hidden ${theme === "dark" ? "dashboard-theme-dark" : ""}`}
    >
      <DashboardSidebar identity={identity} />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <DashboardHeader identity={identity} theme={theme} onToggleTheme={toggleTheme} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-dashboard-canvas">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
