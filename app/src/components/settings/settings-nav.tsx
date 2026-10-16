"use client";

import { Bell, Building2, CreditCard, Receipt, Ruler, ShieldCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  PROFILE_HASH,
  SECURITY_HASH,
  useLocationHash,
} from "@/components/settings/use-location-hash";
import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { SHOW_NOTIFICATION_SETTINGS } from "@/lib/features";
import { cn } from "@/lib/utils";

const ACCOUNT_PATH = "/settings/account";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hash?: string;
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Business",
    items: [
      { href: "/settings", label: "Business information", icon: Building2 },
      { href: "/settings/billing", label: "Plan & billing", icon: Receipt },
      { href: "/settings/payment-methods", label: "Payment methods", icon: CreditCard },
      { href: "/settings/measurement-guide", label: "Measurement guide", icon: Ruler },
    ],
  },
  ...(SHOW_NOTIFICATION_SETTINGS
    ? [
        {
          label: "Communication",
          items: [{ href: "/settings/notifications", label: "Notifications", icon: Bell }],
        },
      ]
    : []),
  {
    label: "You",
    items: [
      { href: ACCOUNT_PATH, hash: PROFILE_HASH, label: "Profile", icon: UserRound },
      { href: ACCOUNT_PATH, hash: SECURITY_HASH, label: "Security", icon: ShieldCheck },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const hash = useLocationHash();
  const actor = useVerifiedActorContext();
  const groups: { label: string; items: NavItem[] }[] =
    actor?.membership.role === "owner"
      ? GROUPS.map((group) =>
          group.label === "Business"
            ? {
                ...group,
                items: [
                  ...group.items,
                  { href: "/settings/members", label: "Members", icon: Users },
                ],
              }
            : group
        )
      : GROUPS;

  // Phones and tablets: every section is visible at once in a two-column grid, never a sideways
  // scrolling row that hides sections off-screen. Laptops: the grouped vertical list.
  return (
    <nav aria-label="Settings" className="grid grid-cols-2 gap-x-2 gap-y-1 lg:flex lg:flex-col lg:gap-5">
      {groups.map((group) => (
        <div key={group.label} className="contents lg:flex lg:flex-col lg:gap-1">
          <p className="hidden px-3 pb-1 text-xs font-medium text-dashboard-muted lg:block">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href && (!item.hash || item.hash === hash);
            return (
              <Link
                key={item.label}
                href={item.hash ? `${item.href}${item.hash}` : item.href}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  // Same page: change the hash directly so Clerk's hash router and this nav both hear it.
                  if (item.hash && pathname === item.href) {
                    event.preventDefault();
                    window.location.hash = item.hash;
                  }
                }}
                className={cn(
                  "relative flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm leading-tight transition-colors lg:min-h-0 lg:whitespace-nowrap after:absolute after:inset-x-3 after:bottom-0 after:h-px after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40",
                  active
                    ? "bg-dashboard-active font-medium text-dashboard-navy after:bg-dashboard-accent"
                    : "text-dashboard-muted after:bg-dashboard-border hover:bg-dashboard-active/60 hover:text-dashboard-navy"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
