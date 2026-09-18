"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  Ruler,
  Settings,
  Shirt,
  Store,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  { href: "/inventory", label: "Clothing / Inventory", icon: Shirt },
  { href: "/customers", label: "Customers", icon: UsersRound },
  { href: "/fittings", label: "Fittings", icon: Ruler },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/storefront", label: "Storefront", icon: Store },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function DrezivoMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 shrink-0 text-dashboard-navy"
      viewBox="0 0 48 48"
      fill="none"
    >
      <path
        d="M8 18.5c6.1-.2 8.8-5.3 13.4-8.5 2.1-1.5 4.8-.6 4.8 2.2 0 4.2-3.6 7.3-8 10.6-3.7 2.8-7.8 5.8-8.8 9.5-.9 3.5 1.7 6.2 5.2 6.2 4.9 0 8.5-4.5 11.6-8.8 2.6-3.6 5.6-7.4 10.6-7.4 1.7 0 3.2.6 4.2 1.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M12 29.4c4.2 1.7 8.2 1.4 11.9-.6 3.2-1.8 5.7-4.7 7.8-7.8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  return (
    <Sidebar aria-label="Primary navigation">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[72px] items-center px-6">
          <Link href="/" aria-label="Drezivo dashboard" className="flex items-center gap-2.5">
            <DrezivoMark />
            {!collapsed && (
              <span className="font-display text-[27px] font-semibold tracking-[-0.04em] text-dashboard-navy">
                Drezivo
              </span>
            )}
          </Link>
        </div>
        <div className="px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open workspace menu"
                className="flex w-full items-center gap-3 rounded-lg py-2 text-left outline-none transition-colors hover:bg-dashboard-active focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
              >
                <Avatar className="h-10 w-10 border border-dashboard-border">
                  <AvatarImage src="/auth-side.png" alt="" />
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-dashboard-navy">
                      Luna&apos;s Gown Rentals
                    </span>
                    <span className="block text-xs text-dashboard-muted">Business Owner</span>
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
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  className={[
                    "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "",
                    isActive
                      ? "bg-dashboard-active text-dashboard-accent"
                      : "text-dashboard-navy/80 hover:bg-dashboard-active hover:text-dashboard-accent",
                  ].join(" ")}
                >
                  <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.8} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
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
