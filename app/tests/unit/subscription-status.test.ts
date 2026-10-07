import { describe, expect, it, vi } from "vitest";

import type { SubscriptionAccess } from "@drezivo/contracts";

vi.mock("@/components/billing/subscribe-dialog", () => ({ SubscribeDialog: () => null }));

const { accessMessage } = await import("@/components/billing/subscription-status");

const base: SubscriptionAccess = {
  level: "full",
  reason: "trial",
  ends_at: null,
  days_left: 10,
  pending_payment: false,
  storefront_online: true,
  storefront_offline_at: null,
  read_only_until: null,
};
// Just under N days away, so the rounded-up count is exactly N.
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000 - 60_000).toISOString();

describe("accessMessage", () => {
  it("does not hardcode one plan price in the shared access message", () => {
    expect(accessMessage(base).body).not.toContain("₱299");
    expect(accessMessage(base).body).toContain("keep your workspace active");
  });

  it("counts down the last days of a trial", () => {
    expect(accessMessage({ ...base, reason: "trial_ending", days_left: 2 }).title).toBe(
      "Your free trial ends in 2 days"
    );
    expect(accessMessage({ ...base, reason: "trial_ending", days_left: 0 }).title).toBe(
      "Your free trial ends today"
    );
  });

  it("explains view-only mode with the storefront and lock countdowns", () => {
    const message = accessMessage({
      ...base,
      level: "read_only",
      reason: "payment_overdue",
      storefront_offline_at: inDays(2),
      read_only_until: inDays(29),
    });
    expect(message.title).toBe("Your subscription has ended");
    expect(message.body).toContain("Your storefront goes offline in 2 days.");
    expect(message.body).toContain("View-only access ends in 29 days.");
  });

  it("says the storefront is offline after the first three days", () => {
    const message = accessMessage({
      ...base,
      level: "read_only",
      reason: "trial_ended",
      storefront_online: false,
      read_only_until: inDays(20),
    });
    expect(message.title).toBe("Your free trial has ended");
    expect(message.body).toContain("Your storefront is offline.");
  });

  it("locks after the view-only days and mentions a waiting payment", () => {
    const message = accessMessage({
      ...base,
      level: "locked",
      reason: "payment_overdue",
      storefront_online: false,
      pending_payment: true,
    });
    expect(message.title).toBe("Your workspace is locked");
    expect(message.body).toContain("waiting for approval");
  });
});
