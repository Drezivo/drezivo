"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  Ruler,
  Settings,
  Shirt,
  Store,
  UserRound,
  UsersRound,
} from "lucide-react";

import type { DashboardIdentity } from "@/components/shell/dashboard-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/inventory", label: "Clothing", icon: Shirt },
  { href: "/customers", label: "Customers", icon: UsersRound },
  { href: "/fittings", label: "Fittings", icon: Ruler },
  { href: "/storefront", label: "Storefront", icon: Store },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function DrezivoMark() {
  return (
    <Image
      src="/brand/drezivo-mark.png"
      alt=""
      aria-hidden="true"
      width={497}
      height={600}
      className="h-8 w-8 shrink-0 object-contain"
    />
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "W";
}

export function DashboardSidebar({ identity }: { identity: DashboardIdentity }) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  return (
    <Sidebar aria-label="Primary navigation">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={collapsed ? "relative flex h-[72px] items-center justify-center" : "flex h-[72px] items-center px-6"}>
          <Link
            href="/"
            aria-label="Drezivo dashboard"
            className={collapsed ? "absolute left-1/2 flex -translate-x-1/2 items-center" : "flex items-center gap-2.5"}
          >
            <DrezivoMark />
            {!collapsed && (
              <span className="font-display text-[27px] font-semibold tracking-[-0.04em] text-dashboard-navy">
                Drezivo
              </span>
            )}
          </Link>
        </div>
        <div className={collapsed ? "flex justify-center px-0" : "px-6"}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open workspace menu"
                className={[
                  "flex items-center gap-3 rounded-lg py-2 text-left outline-none transition-colors hover:bg-dashboard-active focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                  collapsed ? "w-10 justify-center" : "w-full",
                ].join(" ")}
              >
                <Avatar className="h-10 w-10 border border-dashboard-border">
                  {identity.businessLogoUrl ? (
                    <img
                      src={identity.businessLogoUrl}
                      alt={`${identity.businessName} logo`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <AvatarFallback>{initials(identity.businessName)}</AvatarFallback>
                  )}
                </Avatar>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-dashboard-navy">
                      {identity.businessName}
                    </span>
                    <span className="block text-xs text-dashboard-muted">{identity.roleLabel}</span>
                  </span>
                )}
                {!collapsed && <ChevronDown className="h-4 w-4 shrink-0 text-dashboard-navy" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[208px]">
              <DropdownMenuItem>
                <UserRound className="mr-2 h-4 w-4" />
                Business profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Workspace settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav aria-label="Primary" className="mt-5 flex-1 px-4">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <div key={item.href} className="group/navitem relative">
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={[
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-0" : "",
                      isActive
                        ? "bg-dashboard-active text-dashboard-accent"
                        : "text-dashboard-navy/80 hover:bg-dashboard-active hover:text-dashboard-accent",
                    ].join(" ")}
                  >
                    <Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={1.8} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                  {collapsed ? (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-dashboard-border bg-dashboard-surface px-2.5 py-1.5 text-xs font-medium text-dashboard-navy opacity-0 shadow-lg transition-opacity group-hover/navitem:opacity-100 group-focus-within/navitem:opacity-100"
                    >
                      {item.label}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </nav>
        <div className="px-4 pb-6">
          {collapsed ? (
            <button
              type="button"
              aria-label="Open Help Center"
              title="Help Center"
              className="flex h-10 w-full items-center justify-center rounded-lg text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
          ) : (
            <Link
              href="/help"
              className="flex items-center gap-3 rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 transition-colors hover:bg-dashboard-active"
            >
              <HelpCircle className="h-5 w-5 shrink-0 text-dashboard-navy" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-dashboard-navy">Need help?</span>
                <span className="block text-xs text-dashboard-muted">Visit our Help Center</span>
              </span>
              <span aria-hidden="true" className="text-lg text-dashboard-navy">
                ›
              </span>
            </Link>
          )}
        </div>
      </div>
    </Sidebar>
  );
}
