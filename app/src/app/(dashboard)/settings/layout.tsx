"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/business-information", label: "Business information" },
  { href: "/settings/notifications", label: "Notifications" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Settings</h1>
        <nav aria-label="Settings sections" className="mt-3 flex gap-1 border-b border-ink-300">
          {TABS.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "border-b-2 px-3 py-2 text-sm font-medium",
                  isActive ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900",
                ].join(" ")}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
