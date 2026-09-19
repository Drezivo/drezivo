"use client";

import { useCallback, useEffect, useState } from "react";

import { DashboardHeader } from "@/components/shell/dashboard-header";
import { DashboardSidebar } from "@/components/shell/dashboard-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export type DashboardTheme = "light" | "dark";

const DASHBOARD_THEME_STORAGE_KEY = "drezivo.dashboard.theme";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<DashboardTheme>("dark");

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
      <DashboardSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <DashboardHeader theme={theme} onToggleTheme={toggleTheme} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-dashboard-canvas">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
