"use client";

import { useClerk } from "@clerk/nextjs";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";

import type { DashboardIdentity } from "@/components/shell/dashboard-shell";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function dashboardPageLabel(pathname: string) {
  if (pathname.startsWith("/reservations")) return "Reservations";
  if (pathname.startsWith("/calendar")) return "Calendar";
  if (pathname.startsWith("/inventory")) return "Clothing";
  if (pathname.startsWith("/customers")) return "Customers";
  if (pathname.startsWith("/fittings")) return "Fittings";
  if (pathname.startsWith("/payments")) return "Payments";
  if (pathname.startsWith("/storefront")) return "Storefront";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Dashboard";
}

export function DashboardHeader({
  identity,
}: {
  identity: DashboardIdentity;
}) {
  const { signOut } = useClerk();
  const pathname = usePathname();
  const pageLabel = dashboardPageLabel(pathname);

  return (
    <header className="flex min-h-[72px] items-center justify-between gap-2 border-b border-dashboard-border bg-dashboard-surface px-4 py-4 sm:gap-6 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger />
        <div className="min-w-0">
          <Breadcrumb className="flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Workspace</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {/* Notifications and theme controls are intentionally hidden for now. Dark mode is the dashboard default. */}
        <Separator orientation="vertical" className="h-8" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto gap-3 px-0 hover:bg-transparent">
              <Avatar className="h-10 w-10 border border-dashboard-border">
                {identity.userImageUrl && <AvatarImage src={identity.userImageUrl} alt="" />}
                <AvatarFallback>{initials(identity.userName)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-left sm:block">
                <span className="block max-w-48 truncate text-sm font-semibold text-dashboard-navy">
                  {identity.userName}
                </span>
                <span className="block text-xs text-dashboard-muted">{identity.roleLabel}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-dashboard-navy" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserRound className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
