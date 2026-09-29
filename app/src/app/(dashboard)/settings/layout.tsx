import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-4 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">Settings</h1>
          <p className="mt-1.5 text-sm text-dashboard-muted">Your business details, payments, notifications, and account.</p>
        </div>
        {/* Explicit minmax(0,1fr) on phones: an implicit column grows to the menu's full width. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <SettingsNav />
          </aside>
          <div className="min-w-0 pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
