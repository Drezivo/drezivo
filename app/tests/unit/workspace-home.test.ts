import { describe, expect, it } from "vitest";

import { NAV_ITEMS, TAB_HREFS, isActivePath } from "@/components/shell/workspace-nav";
import { WORKSPACE_HOME, breadcrumbsFor } from "@/lib/workspace-routes";

describe("calendar-first workspace", () => {
  it("lands on the calendar and lists it first everywhere", () => {
    expect(WORKSPACE_HOME).toBe("/calendar");
    expect(NAV_ITEMS[0]?.href).toBe("/calendar");
    expect(TAB_HREFS[0]).toBe("/calendar");
  });

  it("keeps the dashboard one click away at /dashboard", () => {
    expect(NAV_ITEMS.some((item) => item.href === "/dashboard" && item.label === "Dashboard")).toBe(true);
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
    expect(isActivePath("/calendar", "/dashboard")).toBe(false);
  });

  it("names the page without a dashboard prefix", () => {
    expect(breadcrumbsFor("/calendar")).toEqual([{ href: "/calendar", label: "Calendar" }]);
    expect(breadcrumbsFor("/dashboard")).toEqual([{ href: "/dashboard", label: "Dashboard" }]);
    expect(breadcrumbsFor("/inventory/new")).toEqual([
      { href: "/inventory", label: "Clothing" },
      { href: "/inventory/new", label: "Add clothing" },
    ]);
  });
});
