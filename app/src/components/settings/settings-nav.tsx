"use client";

import { Bell, Building2, CreditCard, Ruler, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const GROUPS = [
  {
    label: "Business",
    items: [
      { href: "/settings", label: "Business information", icon: Building2 },
      { href: "/settings/payment-methods", label: "Payment methods", icon: CreditCard },
      { href: "/settings/measurement-guide", label: "Measurement guide", icon: Ruler },
    ],
  },
  {
    label: "Communication",
    items: [{ href: "/settings/notifications", label: "Notifications", icon: Bell }],
  },
  {
    label: "You",
    items: [
      { href: "/settings/account", label: "Profile", icon: UserRound },
      { href: "/settings/account#/security", label: "Security", icon: ShieldCheck },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
      {GROUPS.map((group) => (
        <div key={group.label} className="flex shrink-0 gap-1 lg:flex-col">
          <p className="hidden px-3 pb-1 text-xs font-medium text-dashboard-muted lg:block">{group.label}</p>
          {group.items.map(({ href, label, icon: Icon }) => {
            const path = href.split("#")[0];
            const active = pathname === path && !href.includes("#");
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40",
                  active ? "bg-dashboard-active font-medium text-dashboard-navy" : "text-dashboard-muted hover:bg-dashboard-active/60 hover:text-dashboard-navy",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
