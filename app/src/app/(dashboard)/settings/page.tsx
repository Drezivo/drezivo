import { Ruler, Settings2 } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

export default function Page() {
  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">Workspace</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">Settings</h1>
          <p className="mt-1 text-sm text-dashboard-muted">Manage business defaults and workspace preferences.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/settings/measurement-guide" className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30">
            <Card className="h-full gap-0 py-0 transition-colors group-hover:bg-dashboard-active/40">
              <CardContent className="flex items-start gap-3 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl dashboard-tone-blue">
                  <Ruler className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-dashboard-navy">Default Measurement Guide</span>
                  <span className="mt-1 block text-xs leading-5 text-dashboard-muted">Reuse one measurement image across clothing and override only the sizes that need custom measurements.</span>
                </span>
              </CardContent>
            </Card>
          </Link>

          <Card className="gap-0 py-0 opacity-70">
            <CardContent className="flex items-start gap-3 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-neutral-soft text-dashboard-neutral-text">
                <Settings2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-dashboard-navy">More business settings</span>
                <span className="mt-1 block text-xs leading-5 text-dashboard-muted">Additional policy, payment, delivery, and notification settings will live here.</span>
              </span>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
