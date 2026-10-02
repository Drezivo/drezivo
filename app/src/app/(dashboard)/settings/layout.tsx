import { SettingsHeading } from "@/components/settings/settings-heading";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter pt-6">
      <div className="mx-auto w-full max-w-6xl">
        <SettingsHeading />
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
