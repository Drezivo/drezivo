"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import {
  Building2,
  Check,
  ChevronsUpDown,
  CreditCard,
  HelpCircle,
  Loader2,
  Store,
} from "lucide-react";
import { useState } from "react";

import type { DashboardIdentity } from "@/components/shell/dashboard-shell";
import { isActivePath, NAV_ITEMS } from "@/components/shell/workspace-nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { activateAccessibleWorkspace, listAllAccessibleWorkspaces } from "@/lib/workspace-access";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

const WORKSPACE_LINKS = [
  { href: "/settings", label: "Business information", icon: Building2 },
  { href: "/settings/payment-methods", label: "Payment methods", icon: CreditCard },
  { href: "/storefront", label: "Storefront", icon: Store },
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
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "W"
  );
}

/** Square tile for the business, so it never reads as the round personal avatar in the header. */
function BusinessTile({ identity }: { identity: DashboardIdentity }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-gold-soft">
      {identity.businessLogoUrl ? (
        <img
          src={identity.businessLogoUrl}
          alt={`${identity.businessName} logo`}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-display text-base text-dashboard-gold-text">
          {initials(identity.businessName)}
        </span>
      )}
    </span>
  );
}

/** Collapsed-rail label, shown on hover and keyboard focus. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-dashboard-border bg-dashboard-surface px-2.5 py-1.5 text-xs font-medium text-dashboard-navy opacity-0 shadow-lg transition-opacity group-hover/navitem:opacity-100 group-focus-within/navitem:opacity-100"
    >
      {label}
    </span>
  );
}

/**
 * The business this workspace belongs to. Its menu goes to business pages only; your personal
 * account (profile, security, sign out) is the round avatar menu in the header.
 */
function WorkspaceCard({
  identity,
  collapsed,
}: {
  identity: DashboardIdentity;
  collapsed: boolean;
}) {
  const { getToken, orgId } = useAuth();
  const { setActive } = useClerk();
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof listAllAccessibleWorkspaces>>
  >([]);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  async function loadWorkspaces(open: boolean) {
    if (!open) return;
    setIsLoadingWorkspaces(true);
    setWorkspaceError(null);
    try {
      const result = await listAllAccessibleWorkspaces(createDrezivoApiClient(getToken));
      setWorkspaces(result);
    } catch (error) {
      setWorkspaceError(
        error instanceof DrezivoApiError ? error.message : "Could not load workspaces."
      );
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }

  async function switchWorkspace(organizationId: string) {
    if (organizationId === orgId || switchingTo) return;
    setSwitchingTo(organizationId);
    setWorkspaceError(null);
    try {
      await activateAccessibleWorkspace({
        organizationId,
        getToken,
        setActive: (params) => setActive(params),
      });
      // Full reload re-runs the dashboard access gate before any business data renders.
      window.location.assign(WORKSPACE_HOME);
    } catch (error) {
      setWorkspaceError(
        error instanceof DrezivoApiError ? error.message : "Could not switch workspaces."
      );
      // setActive may have changed the Clerk session even if the resulting API verification failed.
      // Leave this shell before it can render cached data with a different organization token.
      window.location.assign("/workspaces/select");
    }
  }

  return (
    <DropdownMenu onOpenChange={(open: boolean) => void loadWorkspaces(open)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${identity.businessName || "workspace"} menu`}
          className={cn(
            "flex items-center gap-3 rounded-xl text-left outline-none transition-colors hover:bg-dashboard-active focus-visible:ring-2 focus-visible:ring-dashboard-accent/40",
            collapsed
              ? "h-12 w-12 justify-center"
              : "w-full border border-dashboard-border bg-dashboard-canvas/60 p-2.5"
          )}
        >
          <BusinessTile identity={identity} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="dashboard-eyebrow block text-[0.625rem] leading-4">Workspace</span>
              <span className="block truncate text-sm font-medium text-dashboard-navy">
                {identity.businessName || "Loading…"}
              </span>
            </span>
          )}
          {!collapsed && (
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="dashboard-eyebrow block">Workspace</span>
          <span className="mt-1 block truncate text-sm font-medium text-dashboard-navy">
            {identity.businessName}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {WORKSPACE_LINKS.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal">
          <span className="dashboard-eyebrow block">Switch workspace</span>
        </DropdownMenuLabel>
        {isLoadingWorkspaces ? (
          <DropdownMenuItem disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Loading workspaces…
          </DropdownMenuItem>
        ) : null}
        {!isLoadingWorkspaces &&
          workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.clerk_org_id}
              disabled={workspace.clerk_org_id === orgId || switchingTo !== null}
              onSelect={(event: Event) => {
                event.preventDefault();
                void switchWorkspace(workspace.clerk_org_id);
              }}
            >
              <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{workspace.tenant.name}</span>
              <span className="ml-2 text-xs text-dashboard-muted">
                {switchingTo === workspace.clerk_org_id
                  ? "Opening…"
                  : workspace.clerk_org_id === orgId
                    ? "Current"
                    : workspace.role === "owner"
                      ? "Owner"
                      : "Front Desk"}
              </span>
              {workspace.clerk_org_id === orgId ? (
                <Check className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}
        {!isLoadingWorkspaces && workspaces.length === 0 && !workspaceError ? (
          <DropdownMenuItem disabled>No workspaces found</DropdownMenuItem>
        ) : null}
        {workspaceError ? (
          <DropdownMenuItem disabled className="whitespace-normal text-dashboard-danger">
            {workspaceError}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardSidebar({ identity }: { identity: DashboardIdentity }) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const helpActive = pathname.startsWith("/help");

  return (
    <Sidebar aria-label="Primary navigation">
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={
            collapsed ? "flex h-16 items-center justify-center" : "flex h-16 items-center px-5"
          }
        >
          <Link
            href={WORKSPACE_HOME}
            aria-label="Drezivo calendar"
            className="flex items-center gap-2.5"
          >
            <DrezivoMark />
            {!collapsed && (
              <span className="font-display text-[1.625rem] font-medium leading-none tracking-[-0.01em] text-dashboard-navy">
                Drezivo
              </span>
            )}
          </Link>
        </div>
        <div className={collapsed ? "flex justify-center" : "px-4"}>
          <WorkspaceCard identity={identity} collapsed={collapsed} />
        </div>
        <nav aria-label="Primary" className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
          {!collapsed && <p className="dashboard-eyebrow px-3 pb-2">Menu</p>}
          <div className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/settings"
                  ? pathname.startsWith("/settings")
                  : isActivePath(pathname, item.href);
              const Icon = item.icon;
              return (
                <div key={item.href} className="group/navitem relative">
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                      collapsed && "justify-center px-0",
                      isActive
                        ? "bg-dashboard-active font-medium text-dashboard-navy before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-dashboard-accent"
                        : "text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
                    )}
                  >
                    <Icon
                      className={cn("h-5 w-5 shrink-0", isActive && "text-dashboard-accent")}
                      strokeWidth={1.7}
                    />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                  {collapsed ? <RailTooltip label={item.label} /> : null}
                </div>
              );
            })}
          </div>
        </nav>
        <div className="px-3 pb-5 pt-3">
          {collapsed ? (
            <div className="group/navitem relative">
              <Link
                href="/help"
                aria-label="Help Center"
                aria-current={helpActive ? "page" : undefined}
                className={cn(
                  "flex h-10 w-full items-center justify-center rounded-lg transition-colors hover:bg-dashboard-active",
                  helpActive
                    ? "bg-dashboard-active text-dashboard-accent"
                    : "text-dashboard-muted hover:text-dashboard-navy"
                )}
              >
                <HelpCircle className="h-5 w-5" strokeWidth={1.7} />
              </Link>
              <RailTooltip label="Help Center" />
            </div>
          ) : (
            <Link
              href="/help"
              aria-current={helpActive ? "page" : undefined}
              className="flex items-center gap-3 rounded-xl border border-dashboard-border bg-dashboard-canvas/60 px-3.5 py-3 transition-colors hover:bg-dashboard-active"
            >
              <HelpCircle className="h-5 w-5 shrink-0 text-dashboard-accent" strokeWidth={1.7} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-dashboard-navy">Need help?</span>
                <span className="block text-xs text-dashboard-muted">Guides and support</span>
              </span>
              <span aria-hidden="true" className="text-lg text-dashboard-muted">
                ›
              </span>
            </Link>
          )}
        </div>
      </div>
    </Sidebar>
  );
}
