import { UserButton } from "@clerk/nextjs";
import { NavLinks } from "@/components/shell/nav-links";
import { BranchSelector } from "@/components/shell/branch-selector";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="grid min-h-screen grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-6 border-r border-ink-300 bg-white px-4 py-6">
          <div className="px-2 text-lg font-semibold text-brand-700">Drezivo</div>
          <WorkspaceSwitcher />
          <NavLinks />
        </aside>
        <div className="flex flex-col">
          <header className="flex items-center justify-between border-b border-ink-300 bg-white px-6 py-3">
            <BranchSelector />
            <UserButton afterSignOutUrl="/sign-in" />
          </header>
          <main className="flex-1 bg-ink-100 px-6 py-6">{children}</main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
