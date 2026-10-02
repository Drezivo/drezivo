"use client";

import { useClerk } from "@clerk/nextjs";
import { ChevronDown, LogOut, Monitor, Moon, ShieldCheck, Sun, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment } from "react";

import type { DashboardIdentity } from "@/components/shell/dashboard-shell";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { PROFILE_HASH, SECURITY_HASH, useLocationHash } from "@/components/settings/use-location-hash";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { setThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { breadcrumbsFor, settingsPageTitle } from "@/lib/workspace-routes";

const ACCOUNT_PATH = "/settings/account";

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function isThemePreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function WorkspaceBreadcrumb({ pathname }: { pathname: string }) {
  const hash = useLocationHash();
  // The account page is two pages to the person using it (Profile, Security), split by Clerk's hash.
  const crumbs = breadcrumbsFor(pathname).map((crumb) =>
    crumb.href === ACCOUNT_PATH ? { ...crumb, label: settingsPageTitle(ACCOUNT_PATH, hash, SECURITY_HASH) } : crumb,
  );
  // Phones show the parent and the current page only; wider screens show the whole trail.
  const firstVisibleOnPhone = Math.max(crumbs.length - 2, 0);

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="min-w-0 flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          const phoneHidden = index < firstVisibleOnPhone;
          return (
            <Fragment key={crumb.href}>
              {index > 0 ? <BreadcrumbSeparator className={cn(index <= firstVisibleOnPhone && "hidden md:block")} /> : null}
              <BreadcrumbItem className={cn("min-w-0", phoneHidden && "hidden md:inline-flex")}>
                {isCurrent ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href} className="truncate">
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The signed-in person's own menu. It is about you (profile, security, theme), never about the
 * business; the business lives on the workspace card at the top of the sidebar.
 */
function AccountMenu({ identity }: { identity: DashboardIdentity }) {
  const { signOut } = useClerk();
  const pathname = usePathname();
  const router = useRouter();
  const { preference } = useTheme();

  // Clerk's profile panel routes by hash, and a client-side push does not fire hashchange, so on
  // the account page the hash is set directly (same approach as SettingsNav).
  const openAccount = (hash: string) => {
    if (pathname === ACCOUNT_PATH) window.location.hash = hash;
    else router.push(`${ACCOUNT_PATH}${hash}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 text-left outline-none transition-colors hover:bg-dashboard-active focus-visible:ring-2 focus-visible:ring-dashboard-accent/40"
        >
          <Avatar className="h-9 w-9 ring-1 ring-dashboard-border">
            {identity.userImageUrl && <AvatarImage src={identity.userImageUrl} alt="" />}
            <AvatarFallback className="bg-dashboard-primary text-xs text-dashboard-primary-ink">
              {initials(identity.userName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-44 truncate text-sm font-medium text-dashboard-navy">{identity.userName}</span>
            <span className="block max-w-44 truncate text-xs text-dashboard-muted">{identity.userEmail}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-dashboard-muted md:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="dashboard-eyebrow block">Your account</span>
          <span className="mt-1 block truncate text-sm font-medium text-dashboard-navy">{identity.userName}</span>
          {identity.userEmail ? (
            <span className="block truncate text-xs text-dashboard-muted">{identity.userEmail}</span>
          ) : null}
          {identity.roleLabel && identity.businessName ? (
            <span className="mt-1 block truncate text-xs text-dashboard-muted">
              {identity.roleLabel} at {identity.businessName}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openAccount(PROFILE_HASH)}>
          <UserRound className="mr-2 h-4 w-4" />
          Your profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openAccount(SECURITY_HASH)}>
          <ShieldCheck className="mr-2 h-4 w-4" />
          Password and security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="dashboard-eyebrow py-1">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value: string) => {
            if (isThemePreference(value)) setThemePreference(value);
          }}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 h-4 w-4" />
            Match system
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardHeader({ identity }: { identity: DashboardIdentity }) {
  const pathname = usePathname();

  return (
    <header className="flex min-h-ws-header items-center justify-between gap-3 border-b border-dashboard-border bg-dashboard-surface/85 px-3 py-2.5 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <SidebarTrigger />
        <WorkspaceBreadcrumb pathname={pathname} />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Notifications stay hidden while the pilot runs without a background worker (lib/features.ts). */}
        <ThemeToggle />
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-dashboard-border" />
        <AccountMenu identity={identity} />
      </div>
    </header>
  );
}
