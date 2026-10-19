"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

const dashboardPaths = new Set([
  "/",
  "/calendar",
  "/calendar/availability",
  "/customers",
  "/dashboard",
  "/fittings",
  "/help",
  "/inventory",
  "/inventory/categories",
  "/inventory/import",
  "/inventory/new",
  "/reservations",
  "/settings",
  "/settings/account",
  "/settings/billing",
  "/settings/measurement-guide",
  "/settings/members",
  "/settings/notifications",
  "/settings/payment-methods",
  "/storefront",
  "/storefront/content",
  "/storefront/details",
  "/storefront/policies",
  "/storefront/requirements",
  "/storefront/settings",
]);

export function sanitizeStaffAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== "pageview") return null;

  let url: URL;
  try {
    url = new URL(event.url);
  } catch {
    // Unknown URL shapes must not reach analytics with private route data.
    return null;
  }

  const path = url.pathname.replace(/\/$/, "") || "/";
  if (dashboardPaths.has(path)) {
    url.pathname = path;
  } else if (/^\/inventory\/[^/]+(?:\/edit)?$/.test(path)) {
    url.pathname = `/inventory/[itemId]${path.endsWith("/edit") ? "/edit" : ""}`;
  } else {
    return null;
  }

  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

export function VercelAnalytics() {
  return <Analytics beforeSend={sanitizeStaffAnalyticsEvent} />;
}
