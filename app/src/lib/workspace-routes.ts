/**
 * Page names for workspace routes: the one source for the header breadcrumb and the Settings page
 * title. A route that is not listed here (a record id, for example) falls back to the label given
 * in DYNAMIC_SEGMENT_LABELS, then to no crumb at all, never to a raw URL segment.
 */
/**
 * Where a signed-in owner or staff member lands. Rental shops run their day from the calendar, so
 * it is the first screen; the dashboard is one click away at /dashboard.
 */
export const WORKSPACE_HOME = "/calendar";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/reservations": "Reservations",
  "/calendar": "Calendar",
  "/calendar/availability": "Availability",
  "/inventory": "Clothing",
  "/inventory/new": "Add clothing",
  "/inventory/categories": "Categories",
  "/customers": "Customers",
  "/fittings": "Fittings",
  "/storefront": "Storefront",
  "/storefront/details": "Store details",
  "/storefront/content": "Homepage content",
  "/storefront/policies": "Rental policies",
  "/storefront/requirements": "Customer requirements",
  "/storefront/settings": "Booking settings",
  "/settings": "Settings",
  "/settings/payment-methods": "Payment methods",
  "/settings/measurement-guide": "Measurement guide",
  "/settings/members": "Members",
  "/settings/account": "Your account",
  "/settings/notifications": "Notifications",
  "/help": "Help Center",
};

/** Labels for path patterns with an id in them, e.g. /inventory/:id/edit. */
const DYNAMIC_SEGMENT_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/inventory\/[^/]+$/, label: "Clothing details" },
  { pattern: /^\/inventory\/[^/]+\/edit$/, label: "Edit clothing" },
];

export function routeLabel(path: string): string | null {
  const known = ROUTE_LABELS[path];
  if (known) return known;
  return DYNAMIC_SEGMENT_LABELS.find(({ pattern }) => pattern.test(path))?.label ?? null;
}

export interface Crumb {
  href: string;
  label: string;
}

/** Section › Sub-page for a pathname. The last crumb is the current page. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const path = pathname.replace(/\/+$/, "") || WORKSPACE_HOME;
  const crumbs: Crumb[] = [];

  const segments = path.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const label = routeLabel(href);
    if (label) crumbs.push({ href, label });
  }
  return crumbs;
}

/** Settings sub-page title; the account page splits into Profile and Security by Clerk's hash. */
export function settingsPageTitle(pathname: string, hash: string, securityHash: string): string {
  if (pathname === "/settings") return "Business information";
  if (pathname === "/settings/account") return hash === securityHash ? "Security" : "Profile";
  return routeLabel(pathname) ?? "Settings";
}
