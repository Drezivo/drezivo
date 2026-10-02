"use client";

import { usePathname } from "next/navigation";

import { SECURITY_HASH, useLocationHash } from "@/components/settings/use-location-hash";
import { settingsPageTitle } from "@/lib/workspace-routes";

/** One h1 per Settings page: the sub-page name, with "Settings" as the section label above it. */
export function SettingsHeading() {
  const pathname = usePathname();
  const hash = useLocationHash();

  return (
    <div className="mb-6">
      <p className="dashboard-eyebrow">Settings</p>
      <h1 className="mt-1 dashboard-page-title">{settingsPageTitle(pathname, hash, SECURITY_HASH)}</h1>
    </div>
  );
}
