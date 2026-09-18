"use client";

import { DashboardHeader } from "@/components/shell/dashboard-header";
import { DashboardSidebar } from "@/components/shell/dashboard-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardSidebar />
      <SidebarInset>
        <DashboardHeader />
        <main className="min-h-0 flex-1 bg-dashboard-canvas">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
