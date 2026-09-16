import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { NavLinks } from "@/components/shell/nav-links";
import { BranchSelector } from "@/components/shell/branch-selector";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="flex flex-col gap-6 border-r border-ink-300 bg-white px-4 py-6">
        <div className="px-2 text-lg font-semibold text-brand-700">Drezivo</div>
        {/*
          TRD §3: background requests fired from a tab that switched organizations must use
          the new org's token/context. OrganizationSwitcher drives Clerk's active
          organization, which lib/api-client.ts reads fresh on every request — there is no
          separate org-id state in this app to fall out of sync.
        */}
        <OrganizationSwitcher
          hidePersonal
          appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between" } }}
        />
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
  );
}
