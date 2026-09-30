import { DashboardAccessGate } from "@/components/shell/dashboard-access-gate";
import { DashboardShell } from "@/components/shell/dashboard-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardAccessGate>
      <DashboardShell>{children}</DashboardShell>
    </DashboardAccessGate>
  );
}
