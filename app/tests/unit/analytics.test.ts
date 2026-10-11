import { describe, expect, it, vi } from "vitest";

import { sanitizeStaffAnalyticsEvent } from "@/components/analytics";

vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));

describe("staff visit analytics", () => {
  it("counts dashboard visits without query or fragment values", () => {
    expect(
      sanitizeStaffAnalyticsEvent({
        type: "pageview",
        url: "https://partners.drezivo.shop/reservations?reservation=private-value#details",
      })
    ).toEqual({ type: "pageview", url: "https://partners.drezivo.shop/reservations" });
  });

  it("groups clothing detail visits without sending the item ID", () => {
    expect(
      sanitizeStaffAnalyticsEvent({
        type: "pageview",
        url: "https://partners.drezivo.shop/inventory/item-123/edit?tab=photos",
      })
    ).toEqual({ type: "pageview", url: "https://partners.drezivo.shop/inventory/[itemId]/edit" });
  });

  it("ignores sign-in, invitation, unknown routes, and custom events", () => {
    for (const path of ["/sign-in", "/accept-invitation/invitation-123", "/future/private-value"]) {
      expect(
        sanitizeStaffAnalyticsEvent({
          type: "pageview",
          url: `https://partners.drezivo.shop${path}`,
        })
      ).toBeNull();
    }

    expect(
      sanitizeStaffAnalyticsEvent({
        type: "event",
        url: "https://partners.drezivo.shop/dashboard",
      })
    ).toBeNull();
    expect(sanitizeStaffAnalyticsEvent({ type: "pageview", url: "invalid-url" })).toBeNull();
  });
});
