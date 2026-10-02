"use client";

import { useClerk } from "@clerk/nextjs";
import { LayoutGrid, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { DashboardIdentity } from "@/components/shell/dashboard-shell";
import { isActivePath, MENU_ITEMS, NAV_ITEMS, TAB_HREFS } from "@/components/shell/workspace-nav";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { setThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const TABS = TAB_HREFS.map((href) => NAV_ITEMS.find((item) => item.href === href)!).map((item) =>
  item.href === "/" ? { ...item, label: "Home" } : item,
);

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Phone navigation (below 768px): four tabs for daily work plus Menu, which opens a bottom sheet
 * with every other page, your account, the theme, and sign out. The hamburger in the header still
 * opens the full sidebar; this bar is the thumb-reach shortcut, not a replacement.
 */
export function MobileTabBar({ identity }: { identity: DashboardIdentity }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabIndex = TABS.findIndex((tab) => isActivePath(pathname, tab.href));
  // Menu reads as current when the sheet is open or the page has no tab of its own.
  const activeIndex = menuOpen || tabIndex === -1 ? TABS.length : tabIndex;

  return (
    <>
      <nav
        aria-label="Quick navigation"
        className="relative shrink-0 border-t border-dashboard-border bg-dashboard-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {/* Gold indicator that slides to the current tab. */}
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-0.5 w-1/5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        >
          <span className="mx-auto block h-full w-8 rounded-full bg-dashboard-accent" />
        </span>
        <ul className="grid h-ws-tabbar grid-cols-5">
          {TABS.map((tab, index) => {
            const active = index === activeIndex;
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className="group flex flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium outline-none transition-transform active:scale-95"
                >
                  <TabIcon icon={Icon} active={active} />
                  <span className={active ? "text-dashboard-navy" : "text-dashboard-muted"}>{tab.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="group flex flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium outline-none transition-transform active:scale-95"
            >
              <TabIcon icon={LayoutGrid} active={activeIndex === TABS.length} />
              <span className={activeIndex === TABS.length ? "text-dashboard-navy" : "text-dashboard-muted"}>Menu</span>
            </button>
          </li>
        </ul>
      </nav>
      <MenuSheet open={menuOpen} onOpenChange={setMenuOpen} identity={identity} pathname={pathname} />
    </>
  );
}

function TabIcon({ icon: Icon, active }: { icon: typeof Sun; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-300 group-focus-visible:ring-2 group-focus-visible:ring-dashboard-accent/50",
        active ? "bg-dashboard-active text-dashboard-accent" : "text-dashboard-muted",
      )}
    >
      <Icon className={cn("h-[22px] w-[22px] transition-transform duration-300", active && "scale-110")} strokeWidth={1.7} />
    </span>
  );
}

function MenuSheet({
  open,
  onOpenChange,
  identity,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: DashboardIdentity;
  pathname: string;
}) {
  const { signOut } = useClerk();
  const { preference } = useTheme();
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88svh] gap-0 overflow-y-auto rounded-t-[1.75rem] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
        <span aria-hidden="true" className="mx-auto mb-4 block h-1 w-10 rounded-full bg-dashboard-border" />
        <p className="dashboard-eyebrow text-dashboard-accent">Menu</p>
        <SheetTitle className="mt-1 truncate pr-10 font-display text-2xl font-medium">
          {identity.businessName || "Workspace"}
        </SheetTitle>
        <SheetDescription className="sr-only">Every workspace page, your account, theme, and sign out.</SheetDescription>

        <ul className="mt-5 grid grid-cols-3 gap-2.5">
          {MENU_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href} className="ws-rise" style={{ "--ws-i": index } as React.CSSProperties}>
                <Link
                  href={item.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex aspect-[1/0.9] flex-col items-center justify-center gap-2 rounded-2xl border px-2 text-center text-xs font-medium transition-colors active:scale-[0.97]",
                    active
                      ? "border-dashboard-accent/60 bg-dashboard-active text-dashboard-navy"
                      : "border-dashboard-border bg-dashboard-canvas text-dashboard-muted hover:text-dashboard-navy",
                  )}
                >
                  <Icon className={cn("h-6 w-6", active ? "text-dashboard-accent" : "text-dashboard-navy")} strokeWidth={1.6} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="dashboard-eyebrow mt-6">You</p>
        <Link
          href="/settings/account"
          onClick={close}
          className="mt-2 flex items-center gap-3 rounded-2xl border border-dashboard-border bg-dashboard-canvas p-3"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-dashboard-primary text-dashboard-primary-ink">
            <UserRound className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-dashboard-navy">{identity.userName}</span>
            <span className="block truncate text-xs text-dashboard-muted">{identity.userEmail}</span>
          </span>
        </Link>

        <div role="radiogroup" aria-label="Theme" className="mt-2.5 grid grid-cols-3 gap-1 rounded-2xl border border-dashboard-border bg-dashboard-canvas p-1">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={preference === value}
              onClick={() => setThemePreference(value)}
              className={cn(
                "flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-colors",
                preference === value ? "bg-dashboard-surface text-dashboard-navy shadow-sm" : "text-dashboard-muted",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void signOut({ redirectUrl: "/sign-in" })}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashboard-danger/30 bg-dashboard-danger/10 p-3 text-left text-dashboard-danger"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Sign out</span>
            <span className="block truncate text-xs opacity-80">{identity.userName}</span>
          </span>
        </button>
      </SheetContent>
    </Sheet>
  );
}
